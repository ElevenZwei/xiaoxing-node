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
export type ToolCallHookFunction = (call: OpenAI.Chat.ChatCompletionMessageToolCall) => void;
export type AddMessageHookFunction = (msg: LLMMsg) => void;
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
              tools: Record<string, LLMTool> | undefined) {
    this.api = new OpenAI(getLLMOption(provider)); 
    this.apiModelName = modelName;
    this.contextMsgCnt = contextMsgCnt;
    if (this.contextMsgCnt < 5) {
      throw new Error(`Context Message count should be larger than 5, cnt=${contextMsgCnt}`);
    }
    this.systemPrompt = systemPrompt;
    if (tools !== undefined) {
      this.toolMap = tools;
      Object.values(tools).forEach((llmt: LLMTool) => this.apiTools.push(llmt.tool));
    }
  }

  setAddMessageHook(hook: AddMessageHookFunction | undefined) {
    this.addMsgHook = hook;
  }

  setToolCallHook(hook: ToolCallHookFunction | undefined) {
    this.toolCallHook = hook;
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
        if (this.toolCallHook !== undefined) this.toolCallHook(tc);
        const args = JSON.parse(tc.function.arguments);
        const toolName = tc.function.name;
        const toolFunc = this.toolMap[toolName]?.callback;
        if (toolFunc == null) {
          throw new Error(`tool not found: name=${toolName}`);
        }
        try {
          const toolResult: string = await toolFunc(...args);
          toolMsgs.push({
            role: LLMRole.Tool,
            tool_call_id: tc.id,
            content: toolResult,
          });
        } catch (err) {
          console.error(`tool call error: name=${toolName}, args=${tc.function.arguments}`);
          throw err;
        }
      });
      await Promise.all(jobs);
    }
    // 仅当没有调用工具或者工具成功调用的时候才记录消息。
    this.add_msg(choice.message);
    toolMsgs.forEach(msg => this.add_msg(msg));
    if (!hasToolCall) {
      return choice.message.content;
    }
    // 现在假定它不会调用两次工具，这里实际上需要递归和层叠检查。
    const secondResp = await this.nextResponse(LLMRole.User, undefined);
    const secondChoice = secondResp.choices[0];
    this.add_msg(secondChoice.message);
    return secondChoice.message.content;
  }

  /**
   * 这个函数不会删除过量的上下文，仅限内部使用。
   */
  async nextResponse(role: LLMRole, content: string | undefined, toolCallId: string | undefined = undefined) {
    if (role === LLMRole.Tool && toolCallId === undefined) {
      throw new Error("ToolCallId should be provided in tool response.");
    }
    const systemMsg: OpenAI.Chat.ChatCompletionSystemMessageParam[] =
        this.systemPrompt !== undefined ? [{ role: 'system', content: this.systemPrompt }] : [];
    const nextMsg: OpenAI.Chat.ChatCompletionMessageParam[] = 
        content !== undefined ? [
            role === LLMRole.Tool
                ? { role, content, tool_call_id: toolCallId as string }
                : { role, content }
        ] : [];
    return await this.api.chat.completions.create({
      model: this.apiModelName,
      messages: [
        ...systemMsg,
        ...this.apiMessages,
        ...nextMsg,
      ],
      tools: this.apiTools,
      tool_choice: 'auto',
    });
  }
  
  private check_msg_cnt() {
    if (this.apiMessages.length > this.contextMsgCnt) {
      this.apiMessages = this.apiMessages.slice(-this.contextMsgCnt);
    }
  }

  private add_msg(msg: LLMMsg) {
    if (this.addMsgHook !== undefined) this.addMsgHook(msg);
    this.apiMessages.push(msg);
  }
}
