import {
  LLMTool, LLMToolPrompt,
  LLMToolFunction, LLMToolFunctionArgs, } from './llm_helper';
import { TTIVolcanoHelper, TTIImageSize } from './tti_helper';
import { S3DHelper, S3DModel } from './s3d_helper';
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

const ttiDescription = (
  '使用自然语言提示词生成图像。该工具接受一段详细的文字描述，并根据其生成一张相应的图像。可用于创建插画、概念艺术、产品图、头像、风景等。\n'

+ '这个工具的返回里包含一个数字表示这个图像的唯一 ID，'
+ '这个工具会自动将生成的图像显示在聊天界面中，不要接着调用显示图像的工具。\n'

+ '注意：因为 TTI 的图像生成模型需要几秒钟生成图像，'
+ '所以在调用这个工具的消息里面可以夹带一些图片的文本描述，'
+ '这可以减少用户等待绘制中的枯燥感。'
+ '而在工具使用完毕之后的文本总结里要少说话，避免让文本影响了用户对新图片的注意力。\n'

+ '另外，当用户说想要某种物品的设计图的时候，调用这个工具应当在图片描述输入中加上白色背景，自然光照，产品渲染等提示词。');

const ttiPromptDescription = (
  '用于描述所需图像的自然语言文本。Please use English if possible to generate a better picture.'
+ '应尽可能详细，包含画面内容、风格、色调、构图元素、背景信息等。'
+ '例如："日落时分的山脉剪影，橙红色的天空，云彩柔和，安静祥和"，'
+ '"赛博朋克风格的未来城市，霓虹灯闪烁，高楼林立，夜晚，烟雾弥漫"，'
+ '"A cozy countryside cabin surrounded by autumn trees, oil painting style, warm color palette"，'
+ '"A futuristic cityscape at night with neon lights and flying cars, in the style of Blade Runner, digital art"'
+ '"未来感十足的电动汽车概念图，银灰色，停在城市广场上，3D 渲染风"。');

const ttiPrompt: LLMToolPrompt = {
  type: 'function',
  function: {
    name: 'generateImageFromText',
    description: ttiDescription,
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
//
const openImageDescription = (
  '打开现有的图片并显示在聊天界面里。这个工具接受一个表示图像的数字标识符，工具会返回对应图片的描述。'
);
const openImagePrompt: LLMToolPrompt = {
  type: 'function',
  function: {
    name: 'openImage',
    description: openImageDescription,
    parameters: {
      type: 'object',
      properties: {
        imageId: {
          type: 'number',
          description: '从其他工具中得到的图片数字标识符，可以代表图片的唯一 ID 。',
        }
      },
      required: ['imageId'],
    },
  },
};

export class OpenImageTool {
  private hook: OpenImageTool.MainHook = async (_input) => {
    return { success: false, error: '开发者没有给出打开图片的逻辑。' };
  };

  get tool(): LLMTool {
    return {
      name: 'openImage',
      prompt: openImagePrompt,
      code: async (args: LLMToolFunctionArgs): Promise<string> => {
        return JSON.stringify(await this.handleToolCall(args));
      }
    };
  }

  setHook(hook: OpenImageTool.MainHook | undefined): void {
    this.hook = async (input) => {
      if (hook === undefined) { return { success: false, error: '没有设置打开图片的逻辑。' }; }
      try {
        return await hook(input);
      } catch (err) {
        // 如果 hook 执行出错，返回一个包含错误信息的输出
        console.error("Error in OpenImageTool hook:", err);
        const error: Error = err instanceof Error ? err : new Error('未知错误');
        return { success: false, error: `处理打开图片时发生错误：${error.message}` };
      }
    };
  }

  private async handleToolCall(args: LLMToolFunctionArgs): Promise<OpenImageTool.Output> {
    // check args against schema
    const parsedArgs = OpenImageToolInputSchema.safeParse(args);
    if (parsedArgs.success) {
      const input: OpenImageTool.Input = parsedArgs.data;
      return this.hook(input);
    } else {
      console.error("Invalid arguments for openImage:", parsedArgs.error);
      return { success: false, error: '请提供有效的输入，形如：{"imageId": 123}' };
    }
  }
};

const OpenImageToolInputSchema = z.object({
  imageId: z.number().describe('从其他工具中得到的图片数字标识符，可以代表图片的唯一 ID。'),
});
export namespace OpenImageTool {
  export type Input = z.infer<typeof OpenImageToolInputSchema>;
  export type Output = { success: true, imageDescription: string; } | { success: false, error: string; };
  export type MainHook = (input: Input) => Promise<Output>;
};

// 设计一个生成 3D 模型的工具函数，输入代表图像的数字标志符，工具会返回引用的图片的描述。
const generate3DModelDescription = (
  '使用图像生成 3D 模型。这个工具接受一张图片，并根据其生成一个 3D 模型。'
  + '生成的模型是 GLB 格式。可以用于产品外观原型、虚拟现实、游戏开发等场景。'
  + '如果成功生成，工具会返回一个表示这个 3D 模型的数字标识符，还有输入的图片描述如果有的话。'
  + '如果生成失败，工具会在返回中包含错误信息。'
  + '注意：生成 3D 模型需要大约 10 秒，请耐心等待，AI 可以在调用时输出一些文字提示。'
);
const generate3DModelPrompt: LLMToolPrompt = {
  type: 'function',
  function: {
    name: 'generate3DModel',
    description: generate3DModelDescription,
    parameters: {
      type: 'object',
      properties: {
        imageId: {
          type: 'number',
          description: '从其他工具中得到的图片数字标识符，可以代表图片的唯一 ID 。',
        },
      },
      required: ['imageId'],
    },
  },
};

export class Generate3DModelTool {
  private inputHook: Generate3DModelTool.InputHook = async (_input) => {
    return { success: false, error: '开发者没有给出读取图片的逻辑。' };
  };
  private outputHook: Generate3DModelTool.OutputHook = async (_input, _output) => {
    return { success: false, error: '开发者没有给出储存输出文件的逻辑。' };
  }

  get tool(): LLMTool {
    return {
      name: 'generate3DModel',
      prompt: generate3DModelPrompt,
      code: async (args: LLMToolFunctionArgs): Promise<string> => {
        return JSON.stringify(await this.handleToolCall(args));
      }
    };
  }

  setInputHook(hook: Generate3DModelTool.InputHook | undefined): void {
    this.inputHook = async (input) => {
      if (hook === undefined) { return { success: false, error: '没有设置读取图片的逻辑。' }; }
      try {
        return await hook(input);
      } catch (err) {
        // 如果 hook 执行出错，返回一个包含错误信息的输出
        console.error("Error in Generate3DModelTool input hook:", err);
        const error: Error = err instanceof Error ? err : new Error('未知错误');
        return { success: false, error: `处理输入时发生错误：${error.message}` };
      }
    };
  }

  setOutputHook(hook: Generate3DModelTool.OutputHook | undefined): void {
    this.outputHook = async (input, output) => {
      if (hook === undefined) { return { success: false, error: '没有设置储存输出文件的逻辑。' }; }
      try {
        return await hook(input, output);
      } catch (err) {
        // 如果 hook 执行出错，返回一个包含错误信息的输出
        console.error("Error in Generate3DModelTool output hook:", err);
        const error: Error = err instanceof Error ? err : new Error('未知错误');
        return { success: false, error: `处理输出时发生错误：${error.message}` };
      }
    };
  }

  private async handleInput(input: LLMToolFunctionArgs): Promise<Generate3DModelTool.ImageInput> {
    const parsedInput = Generate3DModelInputSchema.safeParse(input);
    if (parsedInput.success) {
      const imageIdInput: Generate3DModelTool.Input = parsedInput.data;
      return this.inputHook(imageIdInput);
    } else {
      console.error("Invalid arguments for generate3DModel:", parsedInput.error);
      return { success: false, error: '请提供有效的输入，形如：{"imageId": 123}' };
    }
  }

  private async handleOutput(input: Generate3DModelTool.ImageInput, output: Generate3DModelTool.ModelOutput): Promise<Generate3DModelTool.Output> {
    return this.outputHook(input, output);
  }

  private async handleToolCall(args: LLMToolFunctionArgs): Promise<Generate3DModelTool.Output> {
    // check args against schema
    const imageInput = await this.handleInput(args);
    if (!imageInput.success) {
      return { success: false, error: imageInput.error };
    }
    // 获取图片数据
    const imageData = imageInput.image;
    if (!(imageData instanceof Buffer) || imageData.length === 0) {
      return { success: false, error: '没有提供有效的图片数据。' };
    }
    // 调用 S3DHelper 生成 3D 模型
    const s3dHelper = new S3DHelper(S3DModel.StableFast3D);
    try {
      const modelBuffer = await s3dHelper.generate3DModel(imageData);
      const modelOutput: Generate3DModelTool.ModelOutput = { success: true, model: modelBuffer, imageDescription: imageInput.description };
      return this.handleOutput(imageInput, modelOutput);
    } catch (error) {
      console.error("Error generating 3D model:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `生成 3D 模型失败：${errorMessage}` };
    }
  }
}

const Generate3DModelInputSchema = z.object({
  imageId: z.number().describe('从其他工具中得到的图片数字标识符，可以代表图片的唯一 ID。'),
});
export namespace Generate3DModelTool {
  export type Input = z.infer<typeof Generate3DModelInputSchema>;
  export type ImageInput = (
    { success: true, image: Buffer, description?: string } | { success: false, error: string });
  export type InputHook = (input: Input) => Promise<ImageInput>;
  export type ModelOutput = (
    { success: true, model: Buffer, imageDescription?: string; } | { success: false, error: string; });
  export type Output = (
    { success: true, modelId: bigint, imageDescription?: string; } | { success: false, error: string; });
  export type OutputHook = (input: ImageInput, output: ModelOutput) => Promise<Output>;
}

