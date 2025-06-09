在这个文件里面我们探讨整个从前端到后端的运作过程，
从而判断后端需要提供什么样的接口，执行什么函数。

在流程里面有几个角色：
1. 单片机设备
2. 直接服务单片机设备的 Esp 服务器
3. 负责读写数据库的 Api 服务器
4. 负责提供浏览器界面的 Web 服务器。

# 设备注册登录
机器上电，向服务器发送 Client Login 请求，这是一个 Http Post 。
Esp 服务器读取 Client Login 请求里面的 Device Serial 标识符。
Device Serial 可以使用 Mac Addr 或者 Efuse serial 。

目前这个系统暂时没有包含 `device_credential` 设备身份验证过程。
以后服务器可以在这一步验证 Device Serial 的 HMAC 签名。
这里暂且不会有人仿冒身份，我们继续验证通过的过程。

Esp 服务器把 Serial 转交给 Api 服务器，调用 `device_login_or_register` Api。
Api 服务器使用 Device Serial 查找 `device_info` 数据表。
如果数据表里面有条目，那么检查这一行数据的 `is_allowed` 字段，
如果是 false 那么返回封禁消息。
如果是 true 那么读取 `device_id`, `user_id`, `device_type` 字段。
Esp 服务器把字段储存在连接上下文 `connection_context` 里面。
然后给 Esp 服务器返回登录成功的消息。

如果数据表里面没有条目，那么机器进入注册流程。
如果 `device_registration` 里面有对应 Device Serial 的未过期未使用的条目。
那么 Api 服务器把这个条目里面 reg code 告知 Esp 服务器。
Esp 服务器把注册信息告知设备。
如果没有条目，Api 服务器需要新建一个 `device_registration` 条目，
Api 告知 Esp 服务器进入新注册流程。
Esp 服务器需要准备 code, reg id, device id, reg from ip 这些字段。
Api 服务器把这些字段存入数据库之后把注册码消息 reg code 返回给 Esp 服务器。
Esp 服务器告知用户设备。
设备把消息显示在屏幕上。

用户看到消息之后打开对应的网页，打开添加设备的对话框，
输入对应的注册码。
Web 服务器收到验证码之后调用 Api 添加设备。
Api 服务器在 `device_registration` 表格里面核对验证码。
如果成功，那么填写 `is_used` 字段，然后同步更新
`device_info` 和 `device_info_history` 两个数据表。
并且把注册成功产生的 `device_id` 返回给 Web 服务器。

同时，单片机设备应当定时轮询自己的注册情况。
这可以直接让它循环调用 Client Login Http Post 完成，
如果注册没有结束，那么 Esp - Api - DB 都会返回一样的验证码注册消息。
如果注册结束了，那么 `device_info` 里面有对应的条目，设备会收到登录成功的消息。
这是一个非常简单粗暴的方法。


# 设备新建对话
设备在成功登录之后的默认操作是开启一个新的对话，
但是为了防止用户有无数个空对话，所以只能等到有实际消息的时候再去新建对话。

设备登录之后会有一个 Open Chat 请求，这里的 Chat Id 可以传入一个特殊值 0 。
或者说设备生成一个 `machine_id = 0` 的特殊 Snowflake Id 。
表示开启一个占位的新对话。
用户手动新建对话的时候同样发送含有特殊 Chat Id 的 Open Chat 请求。
Esp 服务器收到 `machine_id = 0` 的特殊值可以用来计算客户端和服务器之间的双向时间延迟。

Esp 服务器收到特殊的 Chat Id 需要在连接上下文里面记录 `chat_id = 0` 。
当设备开始录音的时候，Esp 服务器需要记录语音识别 STT 文本，
这个时候 Esp 服务器检查自己的 Chat Id 是不是有效数字，
如果不是，那么就新建一个对话。
在录音得到第一个非空内容的时候触发，不必等到 STT 完全结束。

Esp 服务器新建对话的时候需要提供 `chat_id`, `user_id`, `chat_name` 字段。
`user_id` 在登录的时候记录在了 Context 里面。
`chat_id` 是现场生成的，
`chat_name` 可以使用现场生成的默认名字，直到用户自己重命名。
生成的方法是 `对话 <number from 1>` 。
用户可以在网页上重命名。或者可以使用语音 LLM Tool 重命名。
Api 服务器收到 `new_chat_session` Api 请求之后新建对话。

Esp 服务器新建对话之后用正式的 `chat_id` 替代 Context 里面的占位符。
并且把新的 id 告知客户端。
这个告知的过程发送 `update_chat_id(from, to)` 。
客户端直接替换现在使用的 id 数据，不要再发送 Open Chat 请求。


# 设备发送消息
Esp 服务器在录音之后，得到 STT 文本，
其中 STT 如果有流式文本结果可以逐步推送给客户端。
Esp 服务器在收集完整的文本之后。
一面要给 LLM 发送，另一面要给 Api 服务器发送文本。
设备在新建消息录音的时候生成的也是特殊的无效 Snowflake Id。
Esp 服务器需要识别这个特殊值，生成真正的 Id 标记这段录音和文本。
Esp 服务器给客户端反馈 STT 结果的时候需要包含 `chat_id`, `message_id` 。
然后 Esp 服务器再去执行后面这些比较麻烦的数据储存工作。

### (Optional) 服务器上传录音
Esp 服务器把录音以 Ogg File 格式压在内存里面，
然后调用 Api 服务器的 `new_binary_object_with_data` Api 上传数据。
这个上传数据的过程不必等到 Api 服务器回复。大不了异步重试。
总之在上传之前就有了 binary object id ，之后可以用来引用这个录音。

## Esp 提交消息
Esp 服务器向 Api 服务器提交 `new_chat_message` Api 。
这里需要 `chat_id`, `message_id`, `sender_type`, `user_id` 等等很多数据。
Api 服务器会把新建消息之后的最新 `message_index` 返回给 Esp 服务器。
Esp 服务器如果收到的 `message_index` 不等于之前的 `message_index + 1` 的话，
表示其中有遗漏的部分，可能是有其他事件产生了消息，或者多人对话。
这个时候 Esp 服务器应当拉取一个 `mesage_index` 范围里面的消息。
其中的细节是 Esp 服务器缓存结构需要考虑的。
在客户端打开某个 Esp 服务器不知道的对话的时候，也是类似的刷新拉取消息的逻辑。

## Message Index 更新后的逻辑
Esp 服务器应当把更新 `message_index` 的消息告知客户端。
`update_last_message(chat_id, message_id, message_index);`
如果客户端发现这些最新的消息自己没有记录，那么客户端应该选择拉取消息。


# Esp 服务器产生 LLM 消息
Esp 服务器和 LLM 通信之后产生 Delta 流式文本。
为了响应速度，Esp 服务器必须在 LLM 产生一点点字符的时候就调用流式 TTS 接口。
这些文字片段和音频帧都会即时推送给客户端。
Esp 服务器逐步积攒文本和音频的回应，直到获得完整的内容之后，和 Api 通信。

Esp 从 TTS 服务器得到的是完整的 Ogg File 内容。
它可以用之前上传录音一样的方式上传 TTS 文件。
然后向 Api 服务器提交 `new_chat_message` Api。
再把更新之后的 `message_index` 告知客户端。

## LLM Tool Call
LLM Tool Call 是 Esp 服务器负责执行。
Esp 服务器需要在 LLM 产生 Tool Request 和 Tool Response 的时候，
都要调用 `new_chat_message` 新建特殊 `message_type` 的消息记录。
这些消息记录对于客户端来说是不可见的。

Tool Function 如果产生了二进制对象，
那么 Tool Function 需要把它上传到 Api 服务器上，调用 `new_binary_object_with_data` 。
并且判断是否需要把二进制对象例如图片加入 Chat Message，
如果需要那么再调用 `new_chat_message` Api。
并且这个新消息由 Esp 服务器推送给客户端。

### (Optional) Upload Tool Call Details
Tool Call 在 Request 和 Response 产生的时候，
Esp 服务器都需要调用 Api 上传数据。

Esp 服务器在启动的时候需要整体读取 `llm_tool_info` 表格，
用里面的 `tool_name`, `tool_definition` 作为 LLM 提示信息。
同时记录 `tool_name` 和 `tool_id` 的对应关系。

Esp 服务器的 before tool call hook 需要向 Api 服务器发送请求，
新建 `call_id`, 新建 `llm_tool_call` 记录。
Esp 服务器的 after tool call hook 需要想 Api 服务器发送请求，
更新 `llm_tool_call` 记录里面的 response 字段。
Tool Function 里面需要向 Api 服务器发送请求，
记录它使用的或者生成的 artifact 。


# 设备接受消息
Esp 如何把各种消息推送给设备，设备在收到消息之后需要做出什么。

因为设备需要追踪 `chat_id`, `message_index` 的变动，显示消息，
所以设备需要一个简化版本的聊天记录表格。
设备一次限制打开一个 Chat ，然后只需要记录自己可以显示的 Message 类型。
其他情况只需要一个 stub 标记自己没有错过这个消息，减少内存使用。

Esp 服务器缓存的聊天记录仅仅需要满足 LLM 的上下文要求。
现在 Esp 服务器都是先对客户端推送内容，然后再是推送 `message_index` 的更新。
`update_last_message(chat_id, message_id, message_index);`
这里客户端如果接收到的 `message_id` 和自己最近一条数据不一样的话，
那么就肯定漏数据了，这个时候触发拉取 index range 的过程。

## ESP 服务器和客户端推送消息的过程
我们再来看看各种消息内容如何推送。
我们以文本和图片两种消息为例。
文本消息有一次性推送和增量 Delta 推送两种情景。

一次性推送的时候需要这些数据：
`new_message(chat_id, message_id, role, type=RawText, content);`
增量推送的时候需要这些数据：
`delta_text_message(chat_id, message_id, chunk_id, role, delta);`
即使是增量推送模式，在增量推送完成之后也要重复一下一次性推送的函数。
客户端收到这些推送之后要及时更新自己的显示内容。

多媒体资源推送的时也用一样的函数。
`new_message(chat_id, message_id, role, type, content);`
这里的 type 多半是 `ImageJpeg` ，content 是 binary object id。
客户端收到这个 id 之后触发 fetch binary object。
`fetch_binary_object(binary_object_id);`

然后 ESP 服务器再从自己的缓存里面把数据推送给客户端设备。
ESP 服务器如果缓存里面没有命中，那么它需要向 Api 服务器请求 Binary Object。
再推送给客户端。
二进制内容的推送是之前已经设计好的 Binary Packet 打包过程。

## ESP 服务器推送 TTS 语音
音频数据没有客户端 fetch 的过程，都是 Esp 服务器推送什么就播放什么。
TTS 合成出来无论是什么格式的数据，都要转成 Opus Frame 数据，
然后做一个计时发送的函数，可以按照播放速度 1.1x 略微快速的速度发送音频帧，
这可以缓解网络的不稳定。

# 设备拉取消息
这个拉取消息的机制相当于缓存失效的机制。
有各种外界事件产生消息的时候会频繁使用。

# Errata
这里记录一下流程设计过程里面发现的数据库错误。之后集中修复。
fixed - `device_registration` 表格需要 `registration_from_ip text` 字段。
fixed - `chat_session` 表格里面的 `shared_at` 字段命名应该是 `created_at` 。



