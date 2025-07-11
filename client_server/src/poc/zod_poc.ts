import * as z from 'zod';
import { zodToJsonSchema } from "zod-to-json-schema";
import { zSid } from '../string';

const ttiPromptDescription = (
  '用于描述所需图像的自然语言文本。Please use English if possible to generate a better picture.'
+ '应尽可能详细，包含画面内容、风格、色调、构图元素、背景信息等。'
+ '例如："日落时分的山脉剪影，橙红色的天空，云彩柔和，安静祥和"，'
+ '"赛博朋克风格的未来城市，霓虹灯闪烁，高楼林立，夜晚，烟雾弥漫"，'
+ '"A cozy countryside cabin surrounded by autumn trees, oil painting style, warm color palette"，'
+ '"A futuristic cityscape at night with neon lights and flying cars, in the style of Blade Runner, digital art"'
+ '"未来感十足的电动汽车概念图，银灰色，停在城市广场上，3D 渲染风"。');

const GenerateImageFromTextInputSchema = z.object({
  id: zSid.describe('生成的图像的唯一标识符。'),
  prompt: z.string().describe(ttiPromptDescription),
  name: z.string().describe('图像的名称或标题。'),
  shape: z.enum(['square', 'landscape', 'portrait']).describe('生成图片的尺寸类型。'),
});

console.log(zodToJsonSchema(GenerateImageFromTextInputSchema));

