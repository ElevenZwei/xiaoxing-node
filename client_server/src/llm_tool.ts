import {
  LLMTool, LLMToolPrompt,
  LLMToolFunction, LLMToolFunctionArgs, } from './llm_helper';
import { TTIVolcanoHelper, TTIImageSize } from './tti_helper';
import { z } from 'zod';

const GenerateImageFromTextInputSchema = z.object({
  prompt: z.string().describe('用于描述所需图像的自然语言文本。'),
  name: z.string().describe('图像的名称或标题。'),
  shape: z.enum(['square', 'landscape', 'portrait']).describe('生成图片的尺寸类型。'),
});

type GenerateImageFromTextInput = z.infer<typeof GenerateImageFromTextInputSchema>;
type GenerateImageFromTextOutput = {
  text: string;
  image?: Buffer;  // 生成的图像数据
  error?: Error;
};

/**
  * 使用自然语言提示词生成图像。
  * 该函数接受一段详细的文字描述，并根据其生成一张相应的图像。
  * 可用于创建插画、概念艺术、产品图、头像、风景等。
  *
  * 这个函数不会抛出异常，错误通过 error 字段返回。
  */
async function generateImageFromText(input: GenerateImageFromTextInput):
  Promise<GenerateImageFromTextOutput> {
  const prompt = input.prompt;
  const shape = input.shape;
  const ttiHelper = new TTIVolcanoHelper();
  const imageSize =
    shape === 'square' ? TTIImageSize.MediumSquare :
    shape === 'landscape' ? TTIImageSize.Medium16x9 : TTIImageSize.Medium3x4;
  try {
    const image = await ttiHelper.generateImageFetch(prompt, imageSize);
    return {
      text: `生成了一张${shape}图像，图像文件已经保存，内容是：${prompt}`,
      image,
    };
  } catch (err) {
    console.error("Error generating image:", err);
    const error: Error = err instanceof Error ? err : new Error('未知错误');
    return {
      text: `生成图像失败：${error.message}`,
      error,
    }
  }
};

const ttiPromptDescription =
          '用于描述所需图像的自然语言文本。'
        + '应尽可能详细，包含画面内容、风格、色调、构图元素、背景信息等。'
        + '例如："日落时分的山脉剪影，橙红色的天空，云彩柔和，安静祥和"，'
        + '"赛博朋克风格的未来城市，霓虹灯闪烁，高楼林立，夜晚，烟雾弥漫"，'
        + '"A cozy countryside cabin surrounded by autumn trees, oil painting style, warm color palette"，'
        + '"A futuristic cityscape at night with neon lights and flying cars, in the style of Blade Runner, digital art"'
        + '"未来感十足的电动汽车概念图，银灰色，停在城市广场上，3D 渲染风"。'
        + '注意：因为 TTI 的图像生成模型需要几秒钟生成图像，所以在调用这个工具的时候同时输出一些开始绘图的文本是个好主意。'
        + '另外，当用户说想要设计图的时候，调用这个工具应当在图片描述输入中加上白色背景，自然光照，产品渲染等提示词。'
        + '这个工具会返回一个数字表示这个图像的唯一 ID，'
        + '这个工具会自动将生成的图像显示在聊天界面中，不必接着调用显示图像的工具。';

const ttiPrompt: LLMToolPrompt = {
  type: 'function',
  function: {
    name: 'generateImageFromText',
    description: '使用自然语言提示词生成图像。该工具接受一段详细的文字描述，并根据其生成一张相应的图像。可用于创建插画、概念艺术、产品图、头像、风景等。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: ttiPromptDescription,
        },
        name: {
          type: 'string',
          description: '图像的名称或标题。可以是任何描述性的文本，例如 "日落山脉" 或 "未来城市"。',
        },
        shape: {
          type: 'string',
          enum: ['square', 'landscape', 'portrait'],
          description: '生成图片的尺寸类型。'
            + '可以是 "square"（正方形）、"landscape"（横向）或 "portrait"（纵向）。',
        },
      },
      required: ['prompt', 'name', 'shape'],
    },
  },
};

export class TTIToolWrapper {
  private hook: TTIToolWrapper.OutputHook =
      async (_input: GenerateImageFromTextInput, output: GenerateImageFromTextOutput) => output;

  get tool(): LLMTool {
    return {
      name: 'generateImageFromText',
      prompt: ttiPrompt,
      code: this.handleToolCall.bind(this),
    }
  }

  setHook(hook: TTIToolWrapper.OutputHook | undefined): void {
    this.hook = async (input, output) => {
      if (hook === undefined) { return output; }
      try {
        return hook(input, output);
      } catch (err) {
        // 如果 hook 执行出错，返回一个包含错误信息的输出
        console.error("Error in TTIToolWrapper hook:", err);
        const error: Error = err instanceof Error ? err : new Error('未知错误');
        return {
          text: `处理图像生成输出时发生错误：${error.message}`,
          error,
        };
      }
    };
  }

  private async generate(input: GenerateImageFromTextInput): Promise<string> {
    // 这里的两个函数都不会抛出异常，错误会通过 error 字段返回
    let output: GenerateImageFromTextOutput = await generateImageFromText(input);
    output = await this.hook(input, output);
    return output.text;
  }

  private async handleToolCall(args: LLMToolFunctionArgs): Promise<string> {
    // check args against schema
    const parsedArgs = GenerateImageFromTextInputSchema.safeParse(args);
    if (parsedArgs.success) {
      const input: GenerateImageFromTextInput = parsedArgs.data;
      return this.generate(input);
    } else {
      console.error("Invalid arguments for generateImageFromText:", parsedArgs.error);
      return '请提供有效的输入，形如：{"prompt": "描述图像内容", "name": "图像名称", "shape": "landscape"}';
    }
  }
}

export namespace TTIToolWrapper {
  export type Input = GenerateImageFromTextInput;
  export type Output = GenerateImageFromTextOutput;
  export type OutputHook = (input: Input, output: Output) => Promise<Output>;
}

// 设计一个显示图像的工具函数，输入代表图像的数字标志符，工具会返回图片描述，把图片显示在屏幕上。



