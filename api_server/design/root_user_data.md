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

