现在首要需要完成的目标就是从新建对话到 LLM 工具调用这一块。

# 新建或者打开对话
设备的 Websocket Hello 结束之后是 Open Chat 请求。
这个请求里面需要 `chat_id`。
`open_chat(chat_id)`。

## 新建占位
Esp 服务器收到之后需要分析这个 `chat_id` 的 `machine_id` 段落是不是零。
在设备启动的第一个 Open Chat 里面都是零。
这表示新建一个 Chat Session 占位符。
这个时候 Esp 服务器设置自己的 Active Chat Id 是 0 。
Esp 服务器需要生成一个 Chat 名字，我意识到在有了分享功能之后这个名字是难免会重复的。
考虑到这个 availble chat name 不会占位。
所以干脆的做法还是不要生成固定的对话名字，在有了真正要上传的对话的时候再考虑。
Esp 服务器返回 `{ action='focus_chat', chat_id = <input>, chat_name='New Chat', last_message_index = 0}` 。

## 新建对话
占位之后在第一个录音的时候肯定会新建对话的。
Esp 服务器调用 `user_create_chat(user_id, chat_id, prefix=<string>)` 
这个表格上其实没有 `unique(user_id, chat_name)` 要求。
但是我们尽量让他不冲突。
Api 服务器需要查询一下这个用户名下的所有 Chat Name，
看一下 `<prefix><number increment>` 的名字哪一个没有被占用。
然后立刻插入一个新的 chat session 数据行。
`chat_id`, `user_id`, `chat_name` 三个字段。
如果 `chat_name` 冲突了就再试试 +1 。
Api 服务器给 Esp 服务器的返回里面包括真正的 `chat_name`。
然后 Esp 服务器给客户端返回 `{ action='focus_chat', chat_id, chat_name, last_message_index=0 }` 。

## 打开历史对话
如果 `open_chat() chat_id.machine_id` 不是零，那么这是一个有效的历史对话。
Esp 服务器需要判断当前用户是否可以打开这个对话。
这需要调用 Api 服务器的 `user_has_chat_permission(user_id, chat_id)` 接口判断权限。
如果权限通过，那么再去 `get_chat(chat_id)` 查询对话信息，获取 `chat_name` 字段。
然后再去 `get_chat_last_message(chat_id)` 查询对话消息的数量。
所以这三者可以在 Api 服务器里面再合成一个更加简单的 Api。
`user_open_chat(user_id, chat_id)`。
Api 服务器返回 `{chat_id, chat_name, last_message_index}` 
Esp 服务器要根据这个 `last_message_index` 判断自己需要还原多少条 LLM 上下文。
Esp 服务器进一步告诉客户端 `{ action='focus_chat', chat_id, chat_name, last_message_index }` 。
客户端根据这个 `last_message_index` 再去判断自己要读取的对话条目范围，拉取相应范围的数据。

# 添加消息


