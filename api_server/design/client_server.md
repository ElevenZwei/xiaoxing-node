# Client Server 结构设计

我们在这里需要考虑一些高层次的问题，Client Server 处理客户端链接的时候需要什么样的结构。LLM, Device, User, DB, Tool 角色如何交互关联。
我目前的代码里面全都在使用 Hook 耦合，但是 Hook 的逻辑如果都集中在一起就会爆炸，所以 Hook 的聚合肯定要一层一层聚合，最后集中到应用层。

LLM 是一个前端处理系统。

