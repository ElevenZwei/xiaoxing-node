# Client Server 结构设计

我们在这里需要考虑一些高层次的问题，Client Server 处理客户端链接的时候需要什么样的结构。LLM, Device, User, DB, Tool 角色如何交互关联。
我目前的代码里面全都在使用 Hook 耦合，但是 Hook 的逻辑如果都集中在一起就会爆炸，所以 Hook 的聚合肯定要一层一层聚合，最后集中到应用层。

LLM 是一个前端处理系统，它可以和其他的东西完全分离。
LLM Helper 可以分成三个组件，一个是上下文和记忆提供，一个是 Tool 提供和调用，一个是收集前两个组建提供的消息进行调用。

另外是关于报错的收集。
报错有好多种类，我们分成 Websocket 业务逻辑中的报错，Third-Party API 的报错，还有 DB API 的报错。
先把 Restore Chat 完成，再把 Log 系统完成。

