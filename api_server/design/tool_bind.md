# 工具绑定
这个功能用来控制什么用户可以看到什么样的工具，可以掌握哪些 AI 角色。
我现在只考虑用户机型和 AI 工具、AI 角色的可见性限制。

之后还需要一层控制用户级别的 AI 工具、AI 角色的可见性，
这个在现在的 Share Table 里面有 AI 角色的分享功能。

AI 角色的可见性和默认是两个概念。我们还需要机型层面的默认和用户层面的默认两种。
表格不要过度设计。

这个是系统配置层面的表格，不是用户操作层面的。这个表格我们就不加 removed at 这样的历史记录了。
设备可以使用哪些 llm avatar 的表格。
llm avatar device type bind
1. bind id (bigint pk)
2. device type (int fk)
3. avatar id (bigint fk)
4. is default (boolean)
5. created at (tz)
6. unique (device type) where default is true.
7. unique (device type, avatar id)

设备可以使用哪些 llm tool 的表格。
llm tool device type bind
1. bind id (bigint pk)
2. device type (int fk)
3. tool id (bigint fk)
4. created at (tz)
5. unique (device type, tool id)

用户操作层面的表格。用户需要一个默认角色的设定。
llm avatar user default bind
1. bind id
2. user id
3. avatar id
4. is active
5. created at
6. removed at
7. unique (user id) where active is true


