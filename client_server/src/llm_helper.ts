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

export type LLMToolPrompt = OpenAI.ChatCompletionTool;
export type LLMToolFunctionArgs = Record<string, unknown>;
export type LLMToolFunction = (args: LLMToolFunctionArgs) => string | Promise<string>;
export interface LLMTool {
  name: string;
  prompt: LLMToolPrompt;
  code: LLMToolFunction;
};

export enum LLMRole {
  System = 'system',
  User = 'user',
  Tool = 'tool',
  AI = 'assistant',
};

// LLMMsg 是 LLM 消息的类型定义，包含了系统消息、AI 消息、用户消息和工具调用消息。
// 在 OpenAI 的 ChatCompletionMessageParam 里面略微缩小了范围。
export type LLMMsg =
  OpenAI.Chat.ChatCompletionSystemMessageParam
  | OpenAI.Chat.ChatCompletionAssistantMessageParam
  | { role: 'user', content: string, name?: string }
  | { role: 'tool', content: string, tool_call_id: string, };
export type LLMRequest = OpenAI.Chat.ChatCompletionMessageParam;
export type LLMResponse = OpenAI.Chat.ChatCompletionMessage;
export type LLMToolCall = OpenAI.Chat.ChatCompletionMessageToolCall;
export type ToolCallHookFunction = (call: LLMToolCall) => boolean;
export type ToolCallFinishHookFunction = (call: LLMToolCall, resp: string) => void;
export type AddMessageHookFunction = (msg: LLMMsg) => boolean;
export type OnDeltaHookFunction = (content: string | null) => void;

export class LLMHelper {
  static Provider = LLMProvider;
  private api: OpenAI;
  private apiModelName: string;
  private apiMessages: LLMMsg[] = [];
  private apiTools: OpenAI.ChatCompletionTool[] = [];
  private toolMap: Record<string, LLMTool> = {};
  private contextMsgCnt: number;
  private systemPrompt: string | undefined;
  private addMsgHook: AddMessageHookFunction = (..._) => true;  // 默认允许添加所有消息
  private toolCallHook: ToolCallHookFunction = (..._) => true;  // 默认允许所有工具调用
  private toolCallFinishHook: ToolCallFinishHookFunction = (..._) => {};
  private onDeltaHook: OnDeltaHookFunction = (..._) => {};

  /* 在以后功能更加多的时候分拆成 Web, Tool, History 三个类型。 */

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
    this.addMsgHook = (msg: LLMMsg) => {
      try {
        if (hook === undefined) return true;
        return hook(msg);
      } catch (err) {
        console.error(`Add message hook error: ${err}`);
        return false; // 中止添加消息
      }
    }
  }

  // 可以用这个函数记录 Tool Call 的情况，也可以中止某个工具的过量使用。
  setToolCallHook(hook: ToolCallHookFunction | undefined) {
    this.toolCallHook = (call: LLMToolCall) => {
      try {
        if (hook === undefined) return true;
        return hook(call);
      } catch (err) {
        console.error(`Tool call hook error: ${err}`);
        return false; // 中止工具调用
      }
    };
  }

  setToolCallFinishHook(hook: ToolCallFinishHookFunction | undefined) {
    this.toolCallFinishHook = (call: LLMToolCall, resp: string) => {
      try {
        if (hook === undefined) return;
        hook(call, resp);
      } catch (err) {
        console.error(`Tool call finish hook error: ${err}`);
      }
    };
  }

  // 可以用这个函数获取流式文本内容的输出。
  // Delta 内容会在每次有新的内容时调用一次。
  // 最后一次调用会传入 null，表示流式输出结束。
  // 这个 null 回调一定会在 AI 的每一条回复触发 addMessageHook 之前触发。
  // 并且保证 null 回调之后一定会触发 addMessageHook。
  // 但不是每个 addMessageHook 事件之前都有 onDeltaHook 事件。
  // 例如用户的输入或者工具的输出不会触发 onDeltaHook。
  setOnDeltaHook(hook: OnDeltaHookFunction | undefined) {
    this.onDeltaHook = (content: string | null) => {
      try {
        if (hook === undefined) return;
        hook(content);
      } catch (err) {
        console.error(`OnDeltaHook error: ${err}`);
      }
    };
  }

  // 恢复历史聊天记录。
  addHistoryMessages(msgs: LLMMsg[]) {
    msgs.forEach(msg => this.addMessage(msg));
    this.checkMessageLimit();
  }

  // 获得当前聊天记录的快照
  getHistoryMessages(): LLMMsg[] {
    return this.apiMessages.slice();
  }

  // 清空聊天记录
  clearHistoryMessages() {
    this.apiMessages = [];
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

  getApiModelName(): string {
    return this.apiModelName;
  }

  getApi(): OpenAI {
    return this.api;
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
    const firstMessage = await this.nextResponse(LLMRole.User, content);
    const message = await this.handlePotentialToolCall(firstMessage);
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
      // console.log(`handlePotentialToolCall: tool calls found, cnt=${toolCalls.length}`
      //     + `, call=${toolCallStr}, depth=${counter}`);
      if (counter > 10) {
        throw new Error(`too many tool calls, cnt=${counter}, last_call=${toolCallStr}`);
      }
      const toolMsgs: LLMMsg[] = [];
      const jobs = toolCalls.map(async (tc: OpenAI.Chat.ChatCompletionMessageToolCall) => {
        const toolName = tc.function.name;
        if (this.toolCallHook(tc) === false) {
          throw new Error(`tool call interrupted by hook: name=${toolName}`);
        }
        const toolFunc = this.toolMap[toolName]?.code;
        if (toolFunc == null) {
          throw new Error(`tool not found: name=${toolName}`);
        }
        const args = tc.function.arguments;
        try {
          const toolArgs = JSON.parse(args);
          console.log(`calling tool: name=${toolName}, args=${args}`);
          const toolResult: string = await toolFunc(toolArgs);
          console.log(`tool call result: name=${toolName}, result=${toolResult}`);
          this.toolCallFinishHook(tc, toolResult);
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
      // 仅当工具成功调用的时候记录 调用结果的消息。
      // TODO: 这里可以考虑分开处理，有的工具调用可能会失败，失败也会需要告知 LLM 。
      toolMsgs.forEach(msg => this.addMessage(msg));
      // 等待下一次回复
      message = await this.nextResponse(undefined, undefined);
    }
    return message;
  }

  /**
   * 这个函数不会删除过量的上下文，仅限内部使用，不要直接和用户对接。
   */
  async nextResponse(role: LLMRole | undefined, content: string | undefined, toolCallId: string | undefined = undefined): Promise<LLMResponse> {
    if (role === LLMRole.Tool && toolCallId === undefined) {
      throw new Error("ToolCallId should be provided in tool response.");
    }
    const systemMsg: OpenAI.Chat.ChatCompletionSystemMessageParam[] =
        this.systemPrompt === undefined ? [] : [
            { role: 'system', content: this.systemPrompt }
        ];
    const nextMsg: LLMMsg[] =
        (role === undefined || content === undefined) ? [] : [
            role === LLMRole.Tool
                ? { role, content, tool_call_id: toolCallId as string }
                : { role, content }
        ];
    // 目前设计成即使没有得到返回也会把发送的消息加入记录。
    if (nextMsg.length > 0) this.addMessage(nextMsg[0]);
    const stream = await this.api.chat.completions.create({
      model: this.apiModelName,
      messages: [
        ...systemMsg,
        ...this.apiMessages,
        ...nextMsg,
      ],
      tools: this.apiTools,
      tool_choice: 'auto',
      stream: true,
    });
    let resContent = '';
    let resRefusal = '';
    let resCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta === undefined) continue;
      if (delta.tool_calls != null && delta.tool_calls.length > 0) {
        delta.tool_calls?.forEach((item) => {
          // Restore ToolCall structure from deltas.
          const idx = item.index;
          if (resCalls[idx] === undefined) {
            // insert new ToolCall
            resCalls[idx] = {
              id: '', function: { arguments: '', name: '', },
              type: 'function',
            };
          }
          const tc = resCalls[idx];
          if (item.id !== undefined) { tc.id += item.id; }
          if (item.function?.name !== undefined) { tc.function.name += item.function.name; }
          if (item.function?.arguments !== undefined) { tc.function.arguments += item.function.arguments; }
        });
      }
      if (delta.content != null && delta.content.length > 0) {
        resContent += delta.content;
        this.onDeltaHook(delta.content);
      }
      if (delta.refusal != null && delta.refusal.length > 0) {
        resRefusal += delta.refusal;
      }
    }
    // 结束时调用一次，表示流式输出结束。
    this.onDeltaHook(null);
    // make final response
    const res: LLMResponse = {
      role: LLMRole.AI,
      content: resContent.length === 0 ? null : resContent,
      refusal: resRefusal.length === 0 ? null : resRefusal,
      tool_calls: resCalls.length === 0 ? undefined : resCalls,
    };
    this.addMessage(res);
    return res;
  }

  private updateApiTools() {
    this.apiTools = Object.values(this.toolMap).map(item => item.prompt);
  }

  private checkMessageLimit() {
    if (this.apiMessages.length > this.contextMsgCnt) {
      this.apiMessages = this.apiMessages.slice(-this.contextMsgCnt);
    }
    // Tool 消息不能作为第一条消息。
    // find first non-tool message in this.apiMessages
    const firstNonToolIndex = this.apiMessages.findIndex(msg => msg.role !== LLMRole.Tool);
    if (firstNonToolIndex < 0) {
      // 如果没有非工具消息，则清空所有消息。
      this.apiMessages = [];
      return;
    }
    this.apiMessages = this.apiMessages.slice(firstNonToolIndex);
  }

  private addMessage(msg: LLMMsg) {
    if (this.addMsgHook(msg) === false)  {
      console.warn(`add message to context interrupted by hook: ${msg.content}`);
      return;
    }
    this.apiMessages.push(msg);
  }

}


/** ChunkCollector 用于聚合 LLM 消息。
  * 它用于 LLM Delta 太琐碎的情况，它是一个收集工具，
  * 提出了三种触发方式：收集到 N 个消息，收到结束符号，或者积攒的消息超过一定时间。
  * 适合在 LLMHelper 的 OnDeltaHook 事件里面使用。
  */
export class ChunkCollector {
  private messages: string[] = [];
  private maxCount: number = 10;
  private maxInterval: number = 1500; // 1.5 seconds
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hook: ChunkCollector.Hook | undefined;

  /** 设置最大消息数量和最大间隔时间。
    * 在添加消息之前设置好需要的触发条件。
    */
  setValues(maxCount: number, maxInterval: number) {
    this.maxCount = maxCount;
    this.maxInterval = maxInterval;
  }

  setChunkHook(hook: ChunkCollector.Hook | undefined) {
    this.hook = hook;
  }

  addText(msg: string | null) {
    if (msg === null) {
      this.trigger(ChunkCollector.Trigger.End);
      return;
    }
    this.messages.push(msg);
    if (this.hook && this.messages.length >= this.maxCount) {
      this.trigger(ChunkCollector.Trigger.Count);
      return;
    }
    if (this.timer === undefined) {
      this.resetTimer();
    }
  }
  getMessages(): string[] {
    return this.messages.slice();
  }
  clearMessages() {
    this.messages = [];
    this.clearTimer();
  }
  flush() {
    this.addText(null); // 触发结束
  }

  private resetTimer() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.trigger(ChunkCollector.Trigger.Timeout);
    }, this.maxInterval);
  }

  private trigger(trigger: ChunkCollector.Trigger) {
    if (this.hook) {
      try {
        // 如果是结束符号，即使消息是空的也要触发一次。
        if (trigger === ChunkCollector.Trigger.End)
          this.hook(this.messages.join(''), trigger);
        else if (this.messages.length > 0)
          this.hook(this.messages.join(''), trigger);
      } catch (err) {
        console.error(`ChunkCollector hook error: ${err}`);
      }
    }
    // 清空消息的时候清除定时器，收到新的第一条消息再开始计时。
    this.clearMessages();
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

export namespace ChunkCollector {
  export enum Trigger {
    Count = 'count',
    End = 'end',
    Timeout = 'timeout',
  }
  export type Hook = (messages: string, trigger: Trigger) => void;
};

