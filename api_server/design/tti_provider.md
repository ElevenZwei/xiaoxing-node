# 绘图模型各平台差异

商业化平台的供应商主要有 OpenAi, Grok, Stable Diffusion, 字节跳动等等。

## 字节跳动
在字节跳动的服务里面，它有很多种不同的文生图接口。
它主推的接口会放在名叫“火山方舟”的产品下，取名“文生图”，好像只有这一个版本。
实际上字节跳动有各种细节接口，可以提供更多的参数。
而火山方舟的那个产品是傻瓜式的，只有文字输入和大小输入两个选项。
我们现在就来说说更细节的接口。

### 火山方舟
火山方舟的图片生成 API 文档是：
https://www.volcengine.com/docs/82379/1541523
在线调用的网页是：
https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?type=GenImage

### 即梦AI
模型的名字是 `jimeng_high_aes_general_v21_L` 。
接口说明如下：
www.volcengine.com/docs/85621/1537648#b3OHfOQz
我们可以看到请求参数比火山方舟更加灵活，
重点是返回的数据非常详细，LLM 的 Prompt 预处理和引擎的运行参数都包含在内。
这个接口唯一的弱点是生成的图片的分辨率受限，
限制在 768x768 的范围里面，需要用 AI Upscale 才能获得大图。
这个接口使用一次收费 0.25 ，比火山方舟略微便宜。

### 通用 3.0 文生图
我感觉这个可能就是火山方舟实际使用的引擎。
模型的名字是 `high_aes_general_v30l_zt2i`
这个引擎的说明如下：
https://www.volcengine.com/docs/85128/1526761

它调用一次收费 0.2 ，我感觉划算多了。

### 通用 3.0 图生图
这是一个输入照片风格的人像图片，输出这个人像在各种画风场景动作下图片的工具。
这个工具可以用来保证同一个人物在不同照片之间的主体一致性。
工具文档：
https://www.volcengine.com/docs/85128/1602212

