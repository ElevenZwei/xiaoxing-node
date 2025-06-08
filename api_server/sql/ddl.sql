-- 用户类型/值定义表（不常查询，仅启动加载）
create table type_value_info (
    type_value          integer primary key,
    type_name           text not null,
    type_meaning        text not null
    -- 想象不到什么时候会有 is_active 字段的应用场景
);

-- 二进制对象存储表
create table binary_object (
    object_id           bigint primary key,
    file_type           integer not null,
    file_size           bigint not null,
    storage_path        text not null,
    mime_type           text not null,
    created_at          timestamptz not null,
);
create index idx_binary_object_type on binary_object(file_type);

-- 用户信息表
create table user_info (
    user_id             bigint primary key,
    user_name           text not null,
    user_type           integer not null,
    user_email          text not null,
    user_locale         text not null,
    created_at          timestamptz not null default now(),
    is_allowd           boolean not null default true
);
create unique index idx_user_info_active on user_info(user_name);

-- 用户认证信息表
create table user_credential (
    pass_id             bigint primary key,
    user_id             bigint references user_info(user_id) on delete cascade,
    pass_type           integer not null,
    pass_value          text, -- may be null for some credential type.
    pass_salt           text, -- may be null.
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    removed_at          timestamptz
);
create index idx_user_credential_user on user_credential(user_id);
create unique index idx_user_credential_user_pass on user_credential(user_id, pass_type) where is_active = true;

-- 用户登录的历史记录。
create table user_login_history (
    user_id             bigint references user_info(user_id) on delete cascade,
    login_from_ip       text not null,
    login_server_id     integer not null,
    login_at            timestamptz
);
create index idx_user_login_id on user_login_history(user_id);

-- 设备信息表
create table device_info (
    device_id           bigint primary key,
    user_id             bigint not null references user_info(user_id) on delete cascade,
    device_type         integer not null,
    device_serial       text not null,
    registered_at       timestamptz not null,
    is_allowed          boolean not null default true
);
create index idx_device_info_user on device_info(user_id);
create unique index idx_device_info_active on device_info(device_serial) include (device_id, is_allowed);

-- 设备的历史信息表格，它和 device_info 同步更新。
-- 在用户删除设备的时候，删除 device_info 里面的数据行，同时 device_info_history 填写 removed_at 字段。
create table device_info_history (
    device_id           bigint primary key,
    user_id             bigint not null references user_info(user_id) on delete cascade,
    device_type         integer not null,
    device_serial       text not null,
    registered_at       timestamptz not null,
    removed_at          timestamptz
);

create table device_login_history (
    device_id           bigint references device_info(device_id) on delete cascade,
    login_from_ip       text not null,
    login_server_id     integer not null,
    login_at            timestamptz
);
create index idx_deivce_login_id on device_login_history(device_id);



-- 聊天会话信息表
create table chat_session (
    chat_id            bigint primary key,
    user_id            bigint not null references user_info(user_id) on delete cascade,
    device_id          bigint not null references device_info(device_id) on delete cascade,
    started_at         timestamptz not null,
    is_active          boolean not null default true
);
create index idx_chat_session_user on chat_session(user_id);
create index idx_chat_session_active on chat_session(chat_id) where is_active = true;

-- 聊天内容表
create table chat_message (
    message_id         bigint primary key,
    chat_id            bigint not null references chat_session(chat_id) on delete cascade,
    sender_type_value  integer not null,
    message_type_value integer not null,
    sent_at            timestamptz not null,
    text_content       text,
    binary_object_id   bigint,
    is_active          boolean not null default true
);
create index idx_chat_message_chat on chat_message(chat_id);
create index idx_chat_message_active on chat_message(message_id) where is_active = true;
create index idx_chat_message_sender_type on chat_message(sender_type_value);
create index idx_chat_message_type on chat_message(message_type_value);


-- llm avatar 信息表
create table llm_avatar_info (
    avatar_id          bigint primary key,
    avatar_name        text not null,
    owner_user_id      bigint not null references user_info(user_id) on delete cascade,
    pinned_prompt      text,
    first_message      text,
    is_public          boolean not null default false,
    is_active          boolean not null default true
);
create index idx_avatar_info_owner on llm_avatar_info(owner_user_id);
create index idx_avatar_info_public on llm_avatar_info(is_public);
create index idx_avatar_info_active on llm_avatar_info(avatar_id) where is_active = true;

-- avatar 工具调用记录
create table llm_tool_call (
    call_id            bigint primary key,
    chat_id            bigint not null references chat_session(chat_id) on delete cascade,
    tool_type_value    integer not null,
    called_at          timestamptz not null,
    arguments          jsonb,
    is_active          boolean not null default true
);
create index idx_tool_call_chat on llm_tool_call(chat_id);
create index idx_tool_call_type on llm_tool_call(tool_type_value);
create index idx_tool_call_active on llm_tool_call(call_id) where is_active = true;

-- avatar 绑定记录（一个 avatar 可供多个用户共享）
create table llm_avatar_binding (
    binding_id         bigint primary key,
    avatar_id          bigint not null references llm_avatar_info(avatar_id) on delete cascade,
    user_id            bigint not null references user_info(user_id) on delete cascade,
    bind_time          timestamptz not null,
    is_active          boolean not null default true
);
create unique index idx_avatar_binding_pair on llm_avatar_binding(avatar_id, user_id) where is_active = true;
create index idx_avatar_binding_user on llm_avatar_binding(user_id);
create index idx_avatar_binding_active on llm_avatar_binding(binding_id) where is_active = true;

-- 审计日志
create table audit_log (
    log_id             bigint primary key,
    user_id            bigint references user_info(user_id) on delete set null,
    action_type_value  integer not null,
    occurred_at        timestamptz not null,
    details            jsonb
);
create index idx_audit_log_user on audit_log(user_id);
create index idx_audit_log_type on audit_log(action_type_value);
