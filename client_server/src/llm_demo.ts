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

export type LLMToolFunction = (args: Record<string, unknown>) => string | Promise<string>;
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
export type LLMResponse = OpenAI.Chat.ChatCompletionMessage;
export type ToolCallHookFunction = (call: OpenAI.Chat.ChatCompletionMessageToolCall) => boolean;
export type AddMessageHookFunction = (msg: LLMMsg) => boolean;
export class LLMHelper {
  api: OpenAI;
  apiModelName: string;
  apiMessages: LLMMsg[] = [];
  apiTools: OpenAI.ChatCompletionTool[] = [];
  toolMap: Record<string, LLMTool> = {};
  contextMsgCnt: number;
  systemPrompt: string | undefined;
  addMsgHook: AddMessageHookFunction | undefined = undefined;
  toolCallHook: ToolCallHookFunction | undefined = undefined;

  /** 
   * contextMsgCnt is the maximum number of messages to keep in context.
   * systemPrompt will be repeated as first message in all conversations.
   * it can be used to set the AI characteristics.
   * tools is an optional list of tools that can be used in the conversation.
   */
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
      this.updateApiTools();
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
    msgs.forEach(msg => this.addMessage(msg));
    this.checkMessageLimit();
  }

  // 移除一个 LLM 可用的工具。
  removeTool(name: string) {
    delete this.toolMap[name];
    this.updateApiTools();
  }

  // 增加一个 LLM 可用的工具。
  addTool(tool: LLMTool) {
    this.toolMap[tool.name] = tool;
    this.updateApiTools();
  }

  /**
   * 这个函数会发送一个用户消息，并等待 AI 的文字回复。
   * @param content 用户输入的内容，如果是 undefined 则表示没有输入。
   * 这个函数会检查消息数量，如果超过限制，则会删除最早的消息。
   * 如果 content 是 undefined，则表示用户没有输入，直接返回 AI 的下一个回复。
   * 如果 content 有值，则会发送一个用户消息，并等待 AI 的回复。
   * 如果 AI 的回复中有工具调用，则会调用工具，并等待工具的结果。
   * 最终返回 AI 的回复内容。
   * @returns AI 的文字回复内容。
   */
  async nextTextReply(content: string | undefined) {
    this.checkMessageLimit();
    const firstResp = await this.nextResponse(LLMRole.User, content);
    const firstMessage = firstResp.choices[0].message;
    const message = await this.handlePotentialToolCall(firstMessage);
    this.addMessage(message);
    return message.content;
  }

  private hasToolCall(message: LLMResponse): boolean {
    const toolCalls = message.tool_calls;
    return toolCalls != null && toolCalls.length > 0;
  }

  /**
   * 这个函数会处理 AI 的回复，如果是工具调用，那么就调用工具回应 AI，直到 AI 不再调用工具为止。
   * 并且返回这个不调用工具的 AI 回复。
   * @param msg 
   */
  private async handlePotentialToolCall(message: LLMResponse): Promise<LLMResponse> {
    let counter = 0;
    while (this.hasToolCall(message)) {
      const toolCalls = message.tool_calls as OpenAI.Chat.ChatCompletionMessageToolCall[];
      // check depth.
      ++counter;
      const toolCallStr = JSON.stringify(message.tool_calls);
      console.log(`handlePotentialToolCall: tool calls found, cnt=${toolCalls.length}`
          + `, call=${toolCallStr}, depth=${counter}`);
      if (counter > 10) {
        throw new Error(`too many tool calls, cnt=${counter}, last_call=${toolCallStr}`);
      }

      const toolMsgs: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
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
          const toolResult: string = await toolFunc(toolArgs);
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
      // 仅当工具成功调用的时候才记录 AI 给出的工具调用和调用结果的消息。
      this.addMessage(message);
      toolMsgs.forEach(msg => this.addMessage(msg));
      // 等待下一次回复
      const secondResp = await this.nextResponse(undefined, undefined);
      message = secondResp.choices[0].message;
    }
    return message;
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
    if (nextMsg.length > 0) this.addMessage(nextMsg[0]);
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
  
  private updateApiTools() {
    this.apiTools = Object.values(this.toolMap).map(item => item.tool);
  }

  private checkMessageLimit() {
    if (this.apiMessages.length > this.contextMsgCnt) {
      this.apiMessages = this.apiMessages.slice(-this.contextMsgCnt);
    }
  }

  private addMessage(msg: LLMMsg) {
    if (this.addMsgHook !== undefined && this.addMsgHook(msg) === false)  {
      console.warn(`add message to context interrupted by hook: ${msg.content}`);
      return;
    }
    this.apiMessages.push(msg);
  }

}
