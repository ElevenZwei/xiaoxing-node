import * as readline from 'readline';
import {
  LLMHelper, LLMProvider,
  LLMTool, LLMToolPrompt, LLMToolFunction, LLMToolFunctionArgs,
  LLMMsg } from './llm_helper';

const systemPrompt = 
  `你是一个活泼友好的年轻女孩，你现在在和用户聊天，你很乐于帮助他解决问题，你需要保持日常聊天的对话风格来回应。你所说的话会经过语音合成传递给用户，所以请不要输出难以朗读的部分，也不要使用表情符号。你应该使用日常对话的方式代替括号等书面表达。`;

const weatherPrompt: LLMToolPrompt = {
  type: 'function',
  function: {
    name: 'getCurrentWeather',
    description: '获取指定城市当前天气',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: '城市名，例如 北京、上海、New York',
        },
      },
      required: ['location'],
    },
  },
};
type GetCurrentWeatherArgs = {
  location: string;
}
const weatherTool: LLMTool = {
  name: 'getCurrentWeather',
  prompt: weatherPrompt,
  code: async (args: LLMToolFunctionArgs) => {
    if (args == null || typeof args.location !== 'string') {
      console.error("Invalid arguments for getCurrentWeather.");
      return '请提供一个有效的城市名。';
    }
    const input = args as GetCurrentWeatherArgs;
    const location = input.location;
    // 模拟天气查询
    return `当前${location}的天气是晴天，温度25度。`;
  }
};



const llm = new LLMHelper(
  LLMProvider.OpenRouter,
  'openai/gpt-4o', 20, systemPrompt,
  [weatherTool]
);

llm.setOnDeltaHook((content: string | null) => {
  if (content != null) {
    console.log(`delta: ${content}`);
  } else {
    console.log("delta finished.");
  }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

rl.on('line', async (input: string) => {
  if (input.length === 0) {
    console.log("请输入想要对大模型说的话。");
    rl.prompt();
    return;
  }
  const output = await llm.nextTextReply(input);
  console.log(`AI: ${output}`);
  rl.prompt();
});

rl.prompt();

