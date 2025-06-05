import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { OpenAI, ClientOptions } from 'openai';

const keyPath = path.resolve(__dirname, '../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const key = yaml.parse(keyFile);
const key_openrouter: string = key.llm.openrouter;
if (typeof key_openrouter !== 'string')
  throw new Error('cannot read openrouter key');

export enum LLMProvider {
  OpenRouter,
}

function getLLMOption(provider: LLMProvider): ClientOptions {
  if (provider === LLMProvider.OpenRouter) {
    return {
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: key_openrouter,
    };
  }
  throw new Error(`unknown provider, ${provider}`);
}

export type LLMToolFunction = (...args: unknown[]) => string | Promise<string>;
export interface LLMTool {
  name: string;
  tool: OpenAI.ChatCompletionTool;
  callback: LLMToolFunction;
};

export enum LLMRole {
  System = 'system',
  User = 'user',
  Tool = 'tool',
  AI = 'assistant',
};

export type LLMMsg = OpenAI.Chat.ChatCompletionMessageParam;
export type ToolCallHookFunction = (call: OpenAI.Chat.ChatCompletionMessageToolCall) => boolean;
export type AddMessageHookFunction = (msg: LLMMsg) => boolean;
export class LLMHelper {
  api: OpenAI;
  apiModelName: string;
  apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  apiTools: OpenAI.ChatCompletionTool[] = [];
  toolMap: Record<string, LLMTool> = {};
  contextMsgCnt: number;
  systemPrompt: string | undefined;
  addMsgHook: AddMessageHookFunction | undefined = undefined;
  toolCallHook: ToolCallHookFunction | undefined = undefined;

  /* systemPrompt will be repeated as first message in all conversations. */
  constructor(provider: LLMProvider,
              modelName: string,
              contextMsgCnt: number,
              systemPrompt: string | undefined,
              tools: LLMTool[] | undefined) {
    this.api = new OpenAI(getLLMOption(provider)); 
    this.apiModelName = modelName;
    this.contextMsgCnt = contextMsgCnt;
    if (this.contextMsgCnt < 5) {
      throw new Error(`Context Message count should be larger than 5, cnt=${contextMsgCnt}`);
    }
    this.systemPrompt = systemPrompt;
    if (tools !== undefined) {
      this.toolMap = tools.reduce((acc, item) => {
          acc[item.name] = item;
          return acc
      }, {} as Record<string, LLMTool>);
      this.update_api_tools();
    }
  }

  // 更新长期保留消息的函数。
  setSystemPrompt(prompt: string | undefined) {
    this.systemPrompt = prompt;
  }

  // 可以用这个函数用来持久化保存聊天记录，也可以阻止某句话放进上下文。
  setAddMessageHook(hook: AddMessageHookFunction | undefined) {
    this.addMsgHook = hook;
  }

  // 可以用这个函数记录 Tool Call 的情况，也可以中止某个工具的过量使用。
  setToolCallHook(hook: ToolCallHookFunction | undefined) {
    this.toolCallHook = hook;
  }

  // 恢复历史聊天记录。
  addHistoryMessages(msgs: LLMMsg[]) {
    msgs.forEach(msg => this.add_msg(msg));
    this.check_msg_cnt();
  }

  // 移除一个 LLM 可用的工具。
  removeTool(name: string) {
    delete this.toolMap[name];
    this.update_api_tools();
  }

  // 增加一个 LLM 可用的工具。
  addTool(tool: LLMTool) {
    this.toolMap[tool.name] = tool;
    this.update_api_tools();
  }

  async nextTextReply(content: string | undefined) {
    this.check_msg_cnt();
    const firstResp = await this.nextResponse(LLMRole.User, content);
    const choice = firstResp.choices[0];
    const toolCalls = choice.message.tool_calls;
    const toolMsgs: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
    const hasToolCall = toolCalls && toolCalls.length > 0;
    if (hasToolCall) {
      // 这是并发执行 Tool Call ，需要注意并发压力。
      const jobs = toolCalls.map(async (tc: OpenAI.Chat.ChatCompletionMessageToolCall) => {
        const toolName = tc.function.name;
        if (this.toolCallHook !== undefined && this.toolCallHook(tc) === false) {
          throw new Error(`tool call interrupted by hook: name=${toolName}`);
        }
        const toolFunc = this.toolMap[toolName]?.callback;
        if (toolFunc == null) {
          throw new Error(`tool not found: name=${toolName}`);
        }
        const args = tc.function.arguments;
        const toolArgs = JSON.parse(args);
        try {
          const toolResult: string = await toolFunc(...toolArgs);
          toolMsgs.push({
            role: LLMRole.Tool,
            tool_call_id: tc.id,
            content: toolResult,
          });
        } catch (err) {
          console.error(`tool call error: name=${toolName}, args=${args}`);
          throw err;
        }
      });
      // 工具调用中的 Error 会向上抛出，由调用者处理要不要给 AI 一个文字回复。
      await Promise.all(jobs);
    }
    // 仅当没有调用工具或者工具成功调用的时候才记录 AI 给出的消息。
    this.add_msg(choice.message);
    toolMsgs.forEach(msg => this.add_msg(msg));
    if (!hasToolCall) {
      return choice.message.content;
    }
    // 现在假定它不会调用两次工具，这里实际上需要递归和层叠检查。
    const secondResp = await this.nextResponse(undefined, undefined);
    const secondChoice = secondResp.choices[0];
    this.add_msg(secondChoice.message);
    return secondChoice.message.content;
  }

  /**
   * 这个函数不会删除过量的上下文，仅限内部使用，不要直接和用户对接。
   */
  async nextResponse(role: LLMRole | undefined, content: string | undefined, toolCallId: string | undefined = undefined) {
    if (role === LLMRole.Tool && toolCallId === undefined) {
      throw new Error("ToolCallId should be provided in tool response.");
    }
    const systemMsg: OpenAI.Chat.ChatCompletionSystemMessageParam[] =
        this.systemPrompt === undefined ? [] : [
            { role: 'system', content: this.systemPrompt }
        ];
    const nextMsg: OpenAI.Chat.ChatCompletionMessageParam[] = 
        (role === undefined || content === undefined) ? [] : [
            role === LLMRole.Tool
                ? { role, content, tool_call_id: toolCallId as string }
                : { role, content }
        ];
    // 目前设计成即使没有得到返回也会把发送的消息加入记录。
    if (nextMsg.length > 0) this.add_msg(nextMsg[0]);
    const res = await this.api.chat.completions.create({
      model: this.apiModelName,
      messages: [
        ...systemMsg,
        ...this.apiMessages,
        ...nextMsg,
      ],
      tools: this.apiTools,
      tool_choice: 'auto',
    });
    return res;
  }
  
  private update_api_tools() {
    Object.values(this.toolMap).forEach((llmt: LLMTool) => this.apiTools.push(llmt.tool));
  }

  private check_msg_cnt() {
    if (this.apiMessages.length > this.contextMsgCnt) {
      this.apiMessages = this.apiMessages.slice(-this.contextMsgCnt);
    }
  }

  private add_msg(msg: LLMMsg) {
    if (this.addMsgHook !== undefined && this.addMsgHook(msg) === false)  {
      console.warn(`add message to context interrupted by hook: ${msg.content}`);
      return;
    }
    this.apiMessages.push(msg);
  }

}
