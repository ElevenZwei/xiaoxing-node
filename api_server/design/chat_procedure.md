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
Esp 服务器返回 `{ type='chat', state='open', chat_id=0, chat_name='New Chat', last_message_index = 0, welcome_text='欢迎使用' }` 。

## 新建对话
占位之后在第一个录音的时候肯定会新建对话的。
Esp 服务器调用 `get user_create_chat(user_id, chat_id, prefix=<string>)` 
这个表格上其实没有 `unique(user_id, chat_name)` 要求。
但是我们尽量让他不冲突。
Api 服务器需要查询一下这个用户名下的所有 Chat Name，
看一下 `<prefix><number increment>` 的名字哪一个没有被占用。
然后立刻插入一个新的 chat session 数据行。
`chat_id`, `user_id`, `chat_name` 三个字段。
Api 服务器给 Esp 服务器的返回里面包括真正的 `chat_name`。
Api 服务器返回三个字段 `{chat_id, chat_name last_message_index}`.
然后 Esp 服务器给客户端返回 `{ type='chat', state='open', chat_id, chat_name, last_message_index=0}` 。

## 打开历史对话
如果 `open_chat() chat_id.machine_id` 不是零，那么这是一个有效的历史对话。
Esp 服务器需要判断当前用户是否可以打开这个对话。
这需要调用 Api 服务器的 `user_has_chat_permission(user_id, chat_id)` 接口判断权限。
如果权限通过，那么再去 `get_chat(chat_id)` 查询对话信息，获取 `chat_name` 字段。
然后再去 `get_chat_last_message(chat_id)` 查询对话消息的数量。
所以这三者可以在 Api 服务器里面再合成一个更加简单的 Api。
`get user_open_chat(user_id, chat_id)`。
Api 服务器返回 `{chat_id, chat_name, last_message_index}` 
Esp 服务器要根据这个 `last_message_index` 判断自己需要还原多少条 LLM 上下文。
Esp 服务器进一步告诉客户端 `{ type='chat', state='open', chat_id, chat_name, last_message_index }` 。
客户端根据这个 `last_message_index` 再去判断自己要读取的对话条目范围，拉取相应范围的数据。

## 客户端的反应
客户端收到 `chat open` 的时候直接覆盖现在聚焦的对话信息。
相当于 `chat open` 是服务器给客户端的指令，用来回应客户端的要求。
如果将来屏幕大了，可以容纳多个对话同时进行了，我们只需要加一个 `pane_id` 参数在通信里面。

# 添加消息
这里要求新建或者打开对话的步骤已经完成。
Esp 服务器收到录音的时候客户端上传的是一个无效 Id，只是用来标记录音。
Esp 服务器需要生成真正的 Id，然后给客户端消息。
这里使用一次下面说的消息推送过程。

这一段和等待 LLM 回复并行。
Esp 服务器随后上传录音，获得 Binary object id。
`post binary_object(object_id, file_type, file_size, file_save_name) with buffer`.
在 Api 服务器内部这个接口叫做 `new_binary_object_with_data` 。
Esp 服务器随后调用新建消息的 api 。
`post chat_message() with json {chat_id, message_id, user_id, ...}`
这个 Api 需要输入一整个可以 `insert into chat_message` 的内容，但是不包括 `message_index`。
`message_index` 由 Api 服务器内部防撞得出。
这个 Api 需要返回 insert 之后的几个字段
返回 `{chat_id, message_id, message_index}`.
Esp 服务器会比较 `message_index` 如果自己有遗漏，那么拉取范围，和打开对话的操作一样。
同时 Esp 服务器把对应的数据推送给用户设备 `update_last_message` 。


## Esp 服务器的消息推送
推送消息的格式按照 `main_procedure.md` 里面所说。
`{ type='message', state='new', chat_id=string, message_id=string, role='user|ai', message_type=0x1, content }`
如果是增量推送，那么只能是文本消息。
`{ type='message', state='delta', chat_id, message_id, chunk_id, role, delta }`
增量推送完成之后还要重复一下 `new_message` 的推送。

推送消息数量更新的方法是。
`{ type='message', state='index', chat_id, message_id, message_index }`


## 客户端的反应
### 收到 `new_message` 或者 `delta_text_message`
客户端的重点在于解析 `chat_id`, `message_id`。
首先判断 `chat_id` 是否和当前的 `focus_chat.chat_id` 相符，
不符合则 Log Error 然后丢弃这个消息。
相符的时候继续处理。
如果类型是文本，需要找到对应 `message_id` 的消息起泡然后追加或者更新文本。

## 收到 `update_last_message` 。






