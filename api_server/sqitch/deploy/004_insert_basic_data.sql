-- Deploy llm_chat:insert_basic_data to pg

BEGIN;

INSERT INTO type_value_info(type_value, type_name, type_meaning, mime_type) VALUES
(0x1,     'TextPlain',             '表示纯文本消息', 'text/plain'),
(0x2,     'TextJson',              '表示 JSON 文本', 'application/json'),

(0x10,    'AudioOpus',            'Ogg 音频文件类型', 'audio/ogg'),
(0x11,    'AudioOpusFrame',       'Opus 音频帧二进制数据，不能直接储存', null),
(0x12,    'AudioWav',             'Wav 音频文件类型', 'audio/wav'),

(0x20,    'ImageJpeg',            'Jpeg 图片文件类型', 'image/jpeg');



INSERT INTO type_value_info (type_value, type_name, type_meaning) VALUES
(0x0,     'Unknown',              '未知类型'),

(0x2001,  'SuperUser',            '超级用户'),
(0x2002,  'AdminUser',            '管理员用户，可以改变其他用户的类型'),
(0x2003,  'CustomServiceUser',    '客服用户，可以登录后台查看用户的数据。'),
(0x2004,  'NormalUser',           '普通用户'),

(0x2201,  'WhitelistIP',          '白名单 IP 直接登录'),
(0x2202,  'PasswordSHA256',       '密码认证，SHA256'),

(0x3001,  'Esp32X1ES',            '工程版小星X1 ESP 客户端'),
(0x3002,  'Esp32X1QS',            '测试版小星X1 ESP 客户端'),
(0x3003,  'Esp32X1Prod',          '商业版小星X1 ESP 客户端'),

(0x4001,  'UserMessage',          '用户发送的消息'),
(0x4002,  'AIMessage',            'AI 发送的消息'),
(0x4003,  'ToolMessage',          '工具调用返回的消息'),
(0x4004,  'HiddenMessage',        '隐藏消息，通常是系统消息，不会显示在聊天记录中'),

(0x4101,  'ToolRequest',          '消息类型是工具调用申请'),
(0x4102,  'ToolResponse',         '消息类型是工具调用回复'),

(0x5001,  'OpenRouter LLM',       'OpenRouter LLM 云平台'),
(0x5002,  'Doubao LLM',           '豆包语言大模型云平台'),

(0x5101,  'No TTS',               '不使用语音合成'),
(0x5102,  'Doubao TTS',           '使用豆包火山引擎语音合成');

/*
对应的十进制版本如下：
INSERT INTO type_value_info (type_value, type_name, type_meaning) VALUES
(0,       'Unknown',              '未知类型'),
(1,       'TextPlain',            '表示纯文本消息'),
(2,       'TextJson',             '表示 JSON 文本'),

(16,      'AudioOpus',            'Ogg 音频文件类型'),
(17,      'AudioOpusFrame',       'Opus 音频帧二进制数据，不能直接储存'),
(18,      'AudioWav',             'Wav 音频文件类型'),

(32,      'ImageJpeg',            'Jpeg 图片文件类型'),

(8193,    'SuperUser',            '超级用户'),
(8194,    'AdminUser',            '管理员用户，可以改变其他用户的类型'),
(8195,    'CustomServiceUser',    '客服用户，可以登录后台查看用户的数据。'),
(8196,    'NormalUser',           '普通用户'),

(8705,    'WhitelistIP',          '白名单 IP 直接登录'),
(8706,    'PasswordSHA256',       '密码认证，SHA256'),

(12289,   'Esp32X1ES',            '工程版小星X1 ESP 客户端'),
(12290,   'Esp32X1QS',            '测试版小星X1 ESP 客户端'),
(12291,   'Esp32X1Prod',          '商业版小星X1 ESP 客户端'),

(16385,   'UserMessage',          '用户发送的消息'),
(16386,   'AIMessage',            'AI 发送的消息'),
(16387,   'ToolMessage',          '工具调用返回的消息'),
(16388,   'HiddenMessage',        '隐藏消息，通常是系统消息，不会显示在聊天记录中'),

(16641,   'ToolRequest',          '消息类型是工具调用申请'),
(16642,   'ToolResponse',         '消息类型是工具调用回复'),

(20481,   'OpenRouter LLM',       'OpenRouter LLM 云平台'),
(20482,   'Doubao LLM',           '豆包语言大模型云平台'),

(20737,   'No TTS',               '不使用语音合成'),
(20738,   'Doubao TTS',           '使用豆包火山引擎语音合成');
 */


COMMIT;
