这个文件要准备数据库的基本数据。

基本数据比如说 Type Values，比如说在没有网页端之前的第一个用户信息，第一个 LLM 角色信息等等。

Type Value Table 有三个字段 value, name, meaning。
需要 Type Value 的表格有：

1. binary object type
2. user type
3. user credential type
4. device type
5. chat message sender type
6. chat message type
7. chat tool type
8. llm provider type
9. tts provider type
10. audit action type
11. audit target type

这里可以划分一下占用的空间。

1. 0x10     0x1fff  binary object type  -- deprecated
2. 0x2000   0x2200  user type
3. 0x2200   0x23ff  credential type
4. 0x3000   0x3100  device type
5. 0x4000   0x4100  chat message sender type
6. 0x4100   0x4200  chat message aux type
7. 0x4200   0x4400  chat tool type  -- deprecated
8. 0x5000   0x5100  llm provider type
9. 0x5100   0x5200  tts provider type
10. 0x10100  0x10200 audit action type
11. 0x10800  0x10900 audit target type

然后 type 占位尽量不从 0 开始，从 base address + 1 的地方开始。
于是我们就可以建立出首先是 binary object type 的含义。

0x0,     'Unknown',          '未知类型'
0x1,     'RawText',          '表示纯文本消息'
0x2,     'TextJson',         '表示 JSON 文本'

0x10,    'AudioOpus',       'Ogg 音频文件类型'
0x11,    'AudioOpusFrame',  'Opus 音频帧二进制数据，不能直接储存'
0x12,    'AudioWav',        'Wav 音频文件类型'

0x20,    'ImageJpeg',       'Jpeg 图片文件类型'

0x2001,  'SuperUser',             '超级用户'
0x2002,  'AdminUser',             '管理员用户，可以改变其他用户的类型'
0x2003,  'CustomServiceUser',     '客服用户，可以登录后台查看用户的数据。'
0x2004,  'NormalUser',            '普通用户'

0x2201,  'WhitelistIP',       '白名单 IP 直接登录'
0x2202,  'PasswordSHA256',    '密码认证，SHA256'

0x3001,  'Esp32X1ES',       '工程版小星X1 ESP 客户端'
0x3002,  'Esp32X1QS',       '测试版小星X1 ESP 客户端'
0x3003,  'Esp32X1Prod',     '商业版小星X1 ESP 客户端'

0x4001,  'UserMessage',     '用户发送的消息'
0x4002,  'AIMessage',       'AI 发送的消息'
0x4003,  'ToolMessage',     '工具调用返回的消息'
0x4004,  'HiddenMessage',   '看不到的消息'

0x4101,  'ToolRequest',     '消息类型是工具调用申请'
0x4102,  'ToolResponse',    '消息类型是工具调用回复'

0x5001,  'OpenRouter LLM',  'OpenRouter LLM 云平台'
0x5002,  'Doubao LLM',      '豆包语言大模型云平台'

0x5101,  'No TTS',          '不使用语音合成'
0x5102,  'Doubao TTS',      '使用豆包火山引擎语音合成'

关于日志审计的功能以后再做了，日志记录是放在 Service 层面实现的。



