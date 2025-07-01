我们需要一个初始超级用户，这样之后的对话才能创建引用。
之后注册设备也需要一个用户，但是现在我不知道硬件设备的 serial 是多少。
所以我只能写一个 template 手动填写 serial 之后才能有效果。
或者说也可以让 demo 现在固定返回登录的用户编号是 1 .

```sql
insert into user_info(user_id, user_name, user_type, user_email, user_locale) values
(1, 'root', 0x2001, 'root@root.com', 'en.US');

insert into device_info(device_id, user_id, device_type, device_serial) values
(1, 1, 0x3001, '<serial>');
```

此外还需要一个临时用户，用于不想要登陆的设备。
这个时候设备处于可以写入，但是无法读取历史记录的状态。
用户可以输入注册用户的命令，让 LLM 调用对应的工具。



