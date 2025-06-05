import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { OpenAI } from 'openai';

const keyPath = path.resolve(__dirname, '../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const key = yaml.parse(keyFile);
const key_openrouter: string = key.llm.openrouter;
if (typeof key_openrouter !== 'string')
  throw new Error('cannot read openrouter key');

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: key_openrouter,
});

async function main() {
  const model_name = 'openai/gpt-4o';
  // 1. 定义工具（function calling）
  const tools: OpenAI.ChatCompletionTool[] = [
    {
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
    },
  ];

  // 2. 用户自然语言提问
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user', content: '请问北京今天的天气如何？' },
  ];

  // 3. 发送请求：让模型判断是否使用工具
  const firstResponse = await openai.chat.completions.create({
    model: model_name,
    messages,
    tools,
    tool_choice: 'auto',
  });

  const choice = firstResponse.choices[0];
  const toolCalls = choice.message.tool_calls;

  if (toolCalls && toolCalls.length > 0) {
    const toolCall = toolCalls[0];
    const args = JSON.parse(toolCall.function.arguments);

    // 4. 执行工具（模拟天气查询函数）
    function getCurrentWeather(location: string): string {
      // 实际情况你可以调用天气 API，这里是模拟数据
      return `${location} 今天晴，气温 28°C，风速 3km/h。`;
    }

    const toolResult = getCurrentWeather(args.location);

    // 5. 发送工具调用结果给模型
    const followup = await openai.chat.completions.create({
      model: model_name,
      messages: [
        ...messages,
        choice.message,
        {
          role: 'tool',
          tool_call_id: toolCall.id,
          // name: toolCall.function.name,
          content: toolResult,
        },
      ],
    });

    console.log('✅ AI 最终回答:');
    console.log(followup.choices[0].message.content);
  } else {
    // 模型没有调用工具，直接回复
    console.log('✅ AI 直接回答:');
    console.log(choice.message.content);
  }
}

main().catch(console.error);


