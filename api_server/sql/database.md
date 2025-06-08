这是一个使用 LLM 作为对话助手的可穿戴设备。可穿戴的部分是一个前端，实际的所有语音识别，文字处理，语音合成都交给后台服务器实现。可穿戴部分负责显示后台传送给它的文本、图片、语音等等。  
用户主要通过音频方式和可穿戴设备互动。用户可以建立新的对话，或者选择继续之前的对话。服务器需要录音、识别、和 LLM 通信、调用可能的 LLM 工具例如图片生成工具等、把多模态的结果以及合成的语音推送给用户设备。  
此外有浏览器端的界面，用户登陆之后可以查看既往的聊天，在浏览器端通过文字继续对话，也可以下载之前通过 LLM 工具例如文生图模型产生的文件资源。用户也有设备管理的功能，从网站上增加或者删除自己的可穿戴设备。  
在用户拿到新设备的时候，他需要登陆网站，打开设备管理的页面。未经注册的新设备连接网络之后会显示一个六位数字验证码，用户把这个验证码输入设备管理页面新增设备的对话框。这样新设备就会被添加到这个用户名下。从网页上或者从可穿戴设备自身的界面上，都有解除用户绑定的功能。  
此外在将来的开发里，计划在网页上增加用户的角色管理功能，在对话的时候可以切换 AI 的角色，获得不一样的回复体验。


根据上面的需要，我设计了一个数据库概念草案。数据库使用 Postgresql。  
接下来逐项说明数据库设计。

数据库里面所有的 ID 标识符，采用了 Snowflake ID 的设计，在同一时间的不同服务器以及客户端持有不同的 machine id ，确保不会相撞。服务器的 machine id 在配置服务器节点的时候手动写出。客户端不占用 machine id ，它新建对象需要生成 snowflake id 的时候填写 machine id = 0 临时标记一下这个对象，最终真正的 snowflake id 完全由服务器一侧生成，并在新建对象的回复中告知客户端。这是安全的防撞方法。  
数据库里面的 Type 字段可以标记各种物件的类型，为了方便，所有的数据里面里面的 Type 字段的取值含义是统一的。这个统一的含义用一个 Type Value 表格储存起来。

Type Value Table
1. type (int32)
2. name (text)
3. meaning (text)
这个 integer code 对应 type 的做法也是为了弥补现有 SQL Enum 类型的不太灵活。这里的 integer 可以 0~1023 对应 binary object asset type， 1024-2048 对应 user type 等等，在列举现有枚举值的时候可以灵活留白以便后续插入新类型。

数据库里面的所有时间戳 timestamp 都使用 timestamptz 类型。

二进制资源 Binary Object 需要占用一个自己的 Id ，需要 Type 和访问方式，于是表格设计如下：

Binary Object Table
1. binary object id (int64)
2. type (int32)
3. size (int64)
4. url or file path (text)
5. mime type (text)
6. add timestamp (timestamptz)

这一层是不储存文件名等等元信息的，文件名在用户的视图层面储存。用户的视图层面例如聊天记录表，是对于二进制资源的命名引用。这就像文件系统分开储存文件名和文件数据一样。

用户信息的表格：

User Info Table.
1. user id (int64)
2. user name (text)
3. user type (int32)
4. user email (text)
5. user locale (text)
6. user add timestamp
7. is active

用户安全凭据的表格：

User Credential.
1. pass id (int64)
2. user id (int64)
3. pass type (int32)
4. pass value (text) 加盐之后 hash 储存。
5. pass salt (text)
6. is active (只有最新的密码这个是 true)
7. pass add timestamp
8. pass remove timestamp (只有最新的密码这个是 null)
建立这个安全凭据表格是为了记录用户之前更改密码等等的操作记录，或者对于多种登陆方式的兼容。

用户登陆是一个日志类型的表格：

User Login History.
1. user id
2. login IP (text)
3. login server machine id (int32)
4. login timestamp

设备信息的表格：  

Device Info.
1. device id (int64)
2. device owner id (int64)
3. device type (int32)
4. device serial (text)
5. device add timestamp
6. device is allowed 这个字段可以限制某个设备能否登陆。

这里要注意当一个设备从第一个用户转移到第二个用户名下的时候，我们需要对新用户建立新的设备配置档案，所以需要建立新的 device id 对应同一个 device serial ，为了避免复杂度，这里另外增加一个表格记录失效的设备注册信息。如下所示：
设备的历史信息表格 Device Info History ，这个表格和 Device Info 同步更新，在用户删除设备的时候，删除 Device Info 里面的数据行，同时给 Device Info History 填写 remove timestamp：  

Device Info History
1. device id (int64)
2. device owner id (int64)
3. device type (int32)
4. device serial (text)
5. device add timestamp
6. device remove timestamp

设备登陆情况是一个日志类型的表格：  

Device login history.
1. device id (int64)
2. device login IP (text)
3. device login server machine id (int32)
4. login timestamp

设备注册过程里面需要分配六位数的验证码，这个过程是，在设备尝试登陆服务器的时候，服务器发现 Device Info 里面没有相同 Device Serial 的条目。此时服务器新建一个 Device Id 储存在设备注册的表格里，并下发六位数的验证码。当用户在网页界面里面输入这个六位数的验证码，此时设备和用户绑定，建立 Device Info 的数据行。
对应的设备注册表格如下：  

Device Registration.
1. device id (int64 primary key)
2. device serial (text unique)
3. registration code (int32 6-digits unique)
4. add timestamp
5. valid until timestamp
为了避免验证码的长期占用，失效的验证码信息移动到另一个表格里面。这个移动的过程可以做成定期扫描的定时任务。
Device Registration Deprecated.
Same Columns as Device Registration Table without unique constraints.

当用户聊天的时候，需要建一个新的对话，储存对话的表格如下：

Chat Info.
1. chat id
2. chat owner id
3. chat name
4. is active
5. add timestamp
6. remove timestamp
unique on (chat owner id, chat name).

对于未来可能共享对话的情景，用一个表格记录共享的对话。

Chat Share Info.
1. chat id
2. share user id
3. is active
4. add timestamp
5. remove timestamp

对话里面的每一条聊天记录需要如下的储存：

Chat Message Info.
1. message id
2. chat id
3. message index (from 1, int32)
4. message role type (int32, ai or user or tool)
5. message role id (int64)  
这个字段，当 role = ai 时表示未来计划的 AI 角色功能，储存 AI 角色编号的字段，当 role = user 的时候储存发送这条信息的 user id，当 role = tool 的时候储存 tool id。
6. message type (int32)   
这个字段和 binary object type 共用同一段 type 数值，外加需要表示纯文本类型的数值，表示大模型一些辅助过程例如 Tool Request / Tool Response 的数值。
7. message content (string)
8. message has binary (boolean)
9. message binary object id (int64)
10. message binary object name (text)
11. hidden from user (boolean)
12. hidden from ai (boolean)
13. is active
14. add timestamp (timestamptz)
15. remove timestamp

注意这里的 message 多种多样。  
当 message type 是纯文本的时候，message binary object id 字段指向的二进制对象是这段文本的音频资源。当 role type 是 user 时是可穿戴设备的录音文件，当 role type 是 ai 时是 LLM 文本的语音合成文件。这里二进制对象的 binary object id 为了方便标识可以直接和 message id 共用同一个 snowflake int64 数值，这恐怕是唯一共享 snowflake id 的时刻了。绝大多数时候的纯文本都有对应的音频文件，因为可穿戴设备主要通过音频交流。如果没有对应的音频资源，例如使用输入法打字交流，那么 message binary object id 字段为空。  
当 message type 是 binary object type 的那些类型的时候，通常是多媒体文件。message binary object id 字段指向对应的资源，然后 message binary object name 字段储存对应的文件名。这个时候 message content 应该为空。  
当 message type 是大模型辅助类型的时候，message binary object id 字段应该是空的，这些过程的 hidden from user 应该是 true，表示不在用户界面上显示通信的内容。然后在 message content 里面储存 LLM 提出的 JSON 文本，还有 Tool 给出的文本回复。 

考虑到 LLM 的 Tool Call，还需要一张表格记录 Tool Call 的过程，相当于解析了一下 LLM 对话过程里的 Tool Request 和 Tool Response 的内容储存在专门的表格里面。一个 LLM Tool Request 里面可能含有多个 Tool Call 。

Tool Call History.
1. tool call id (int64)
2. message id (int64)
3. tool id (int64)
4. tool arguments (jsonb)
5. tool response (text)

对于 Tool 信息，需要一个表格储存起来，这个只是记录使用的表格，应该只会查找它的 name 和 id 的对应关系。

Tool Info
1. tool id
2. tool name
3. tool arguments (jsonb)
4. tool description
5. add timestamp

考虑到有的 Tool Call 会建立多个资源文件，所以这里需要一个表格记录，这个表格应该只会作为历史记录使用，在调用工具的时候就会把生成的资源加入 Chat Message 表格里，不会在之后经常查询这个表格。

Tool Call Artifact.
1. tool call id
2. artifact name (text)  
当 Tool 会输出多个文件的时候，这个字段储存的是相对于这个 Tool 有意义的名称。
3. binary object id (int64)

有的 Tool Call 不一定产生 Artifact，此时这里没有数据行。


对于 AI 角色，需要一个表格：  

LLM Avatar Info
1. avatar id (int64)
2. avatar name
3. avatar owner id
4. avatar pinned prompt
5. avatar first message
6. avatar is public (boolean)
7. And other potential fields to configure an avatar, maybe TTS arguments.

尽管系统有一个新建对话时默认的基本 AI 角色（avatar id = 0），不过用户可以把自己的 AI 角色设置成自己某个设备的默认 AI 角色。

LLM Avatar Bind
1. avatar id
2. device id
3. is active
4. add timestamp
5. remove timestamp

未来多个用户共享 AI 角色的话需要的表格。

LLM Avatar Share Info
1. avatar id
2. share user id
3. is active
4. add timestamp.
5. remove timestamp.

审计表，这个相当于日志的格式化版本，相当于把上面各种表的条目引用了一下方便日后调查。

Audit Log
1. user id (int64)
2. action type (int32)
3. target type (int32)
4. target id (int64) 根据不同的 target type 去找对应表格的条目。
5. timestamp
6. details (jsonb)

