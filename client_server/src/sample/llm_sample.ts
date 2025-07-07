import * as readline from 'readline';
import {
  LLMHelper, LLMProvider,
  LLMTool, LLMToolPrompt, LLMToolFunction, LLMToolFunctionArgs,
  LLMMsg } from '../llm_helper';
import { TTIVolcanoHelper, TTIImageSize } from '../tti_helper';
import fs from 'fs';
import path from 'path';
import { TTIToolWrapper } from '../llm_tool';
import sanitize from 'sanitize-filename';

// TODO: 这里可以让它输出内容附带的心情说明，可以是开心、悲伤、愤怒等情绪描述，辅助语音合成时的情感表达。
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

const ttiWrap = new TTIToolWrapper();
ttiWrap.setHook(async (input, output) => {
  const filename = sanitize(input.name || 'image') + '.jpg';
  if (output.success === false) {
    console.error(`TTIToolWrapper error: ${output.error}`);
    return { success: false, error: output.error.message };
  }
  const data = output.image;
  if (data == null || data.length === 0) {
    console.error("TTIToolWrapper output image is empty or null.");
    return { success: false, error: "生成的图片数据为空或无效。" };
  }
  const filepath = path.join(__dirname, `../../data/media/${filename}`);
  await fs.promises.mkdir(path.dirname(filepath), { recursive: true });
  await fs.promises.writeFile(filepath, data);
  return { success: true, text: `生成的图片已保存为 ${filename}。`, imageId: 0n };
});

const llm = new LLMHelper(
  LLMProvider.OpenRouter,
  'openai/gpt-4o', 20, systemPrompt,
  [weatherTool, ttiWrap.tool, ]
);

llm.setOnDeltaHook((content: string | null) => {
  if (content != null) {
    // console.log(`delta: ${content}`);
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

