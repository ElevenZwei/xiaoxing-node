# LLM Tool DB Table
这个文件根据 `tool_bind.md` 的讨论制定更加系统的表格数据。  
考虑程序加载和使用表格的逻辑范畴。  
制定表格要考虑三个层面的需求 `availability`, `enable`, `default` 。  
只有 LLM Avatar 有用户层级的 `default`，LLM Tool 的默认值是跟着 LLM Avatar 的设置走。

## 工具定义  
在之前工具定义的基础上需要做很多的修改。  
工具会不断创建新的资源，为此我应该专门整理一个资源消息类型，  
储存在 Chat 里面出现的资源，和 Chat Message 分开存放。  
这样在还原 Chat Context 的时候会非常有优势。  

这种资源，它可能是一个句柄，它并不对应任何可以储存的 Binary Object。  
而且这种资源类型，它需要是根据 MCP Server 的加载成为一个热插拔的对象。  
之前在 `type_value_info` 表格里面储存 `binary_object_type` 和 `chat_tool_type` 的做法不够。  
`type_value_info` 从一开始就设计成几乎不写入，只读取的 const 表格。  
这样核心的数据更加不能对用户开放随意修改。  

所以对于 Chat Tool ，需要另外一个表格 `chat_tool_type` 和 `resource_type` 。  
`resource_type` 是对于 `binary_object_type` 的扩充，  
对于非内置的，不使用服务器储存系统的资源，我们把它放在 `resource_type` 表格里面，  
为了防止数据冗余和引用混乱，服务器内置的储存系统也要使用 `resource_type` 。  
让 Chat Message Type 和 File Type 字段都引用 `resource_type` 系统。  
这样的设计是否可以支持用户的热插拔呢？我也不确定了。  

假设系统管理员想要添加一个新的 MCP 服务，MCP 服务会对 LLM 申报自己的函数集合。  
MCP 服务自己占用一个新的 `chat_tool_type` ，  
MCP 服务自己通常会提供一个函数获取它内部现有的资源集合，这个集合可以直接传给 LLM 。  
这里面的资源类型不是非要做成 `resource_type` 数据行。  
`resource_type` 数据行是为了整理在一个 Chat 里面出现过的资源而生的。  
如果不需要这种整理就没必要记录 `resource_type` 。  
就像我们内置的工具，可能更加需要这种整合，和交互功能，所以做成 `resource_type` 会更好。  

那么我们就重新写一个 `resource_type` 表格。  

Resource Type Table
1. value integer pk,
2. name text not null,
3. meaning text not null,
4. mime_type text,

然后把 binary object table 和 chat message table 里面的类型外键都指向这个表格。  
还需要建立一个 Chat Resource 整合表格。  

Chat Resource Table
1. entry id bigint pk not null,
2. chat id bigint fk(chat) not null,
3. resource type fk(resource_type) not null,
4. resource id bigint fk(binary_object), -- for internal objects
5. resource ref text,  -- for outside objects, maybe url or text for MCP to parse.  




Chat Tool Type Table


## 角色定义


## 工具绑定
这里是关于 `availability` 和 `default` 的储存方式。

前面是系统配置层面的表格，不是用户操作层面的。这个表格我们就不加 removed at 这样的历史记录了。  
设备可以使用哪些 llm avatar 的表格。  

llm avatar device type availability `(availability & default)`
1. bind id (bigint pk)
2. device type (int fk)
3. avatar id (bigint fk)
4. is default (boolean)
5. created at (tz)
6. unique (device type) where default is true.
7. unique (device type, avatar id)

设备可以使用哪些 llm tool 的表格。  

llm tool device type availability `availability`
1. bind id (bigint pk)
2. device type (int fk)
3. tool id (bigint fk)
4. created at (tz)
5. unique (device type, tool id)

然后这是 `default` 层面的表格。  
用户操作层面的表格。用户需要一个默认角色的设定。  
但是如果这个用户的默认角色不是当前设备可用的角色，这应该怎么办，  
这应该回退到当前设备的默认设置上面。  

llm avatar user default bind
1. bind id
2. user id
3. avatar id
4. is active
5. created at
6. removed at
7. unique (user id) where active is true

程序在读取的时候。  
1. 读取 llm tool device type availability 得到 Tool 列表。
2. 先读取 llm avatar device type，再 Load User Id 得到 Default Avatar 。  

