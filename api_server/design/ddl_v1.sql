-- 2025-06-08
-- PostgreSQL DDL for the LLM Chat Application
-- 草案更改先写到这个文件，等到稳定后再迁移到 sqitch 的 deploy 脚本中。

-- 用户类型/值定义表（不常查询，仅启动加载）
create table type_value_info (
    type_value          integer primary key,
    type_name           text not null,
    type_meaning        text not null,
    mime_type           text -- 可选，表示 MIME 类型
);

-- 二进制对象存储表
create table binary_object (
    object_id           bigint primary key,
    file_type           integer not null references type_value_info(type_value),
    file_size           bigint not null,
    storage_path        text not null,
    created_at          timestamptz not null default now()
    description         text,
);
create unique index idx_binary_object_path on binary_object(storage_path);
create index idx_binary_object_type on binary_object(file_type);

-- 用户信息表
-- 用户不能删除自己的账号，但可以删除自己的认证信息（例如密码、OAuth2 等）。
-- 用户可以被禁用（is_allowed = false），但不能被删除。
create table user_info (
    user_id             bigint primary key,
    user_name           text not null,
    user_type           integer not null references type_value_info(type_value),
    user_email          text not null,
    user_locale         text not null,
    user_avatar_id      bigint references binary_object(object_id) on delete set null,
    user_description    text,
    is_allowed          boolean not null default true
);
create unique index idx_user_info_name on user_info(user_name);
create unique index idx_user_info_email on user_info(user_email);

-- 用户认证信息表
create table user_credential (
    pass_id             bigint primary key,
    user_id             bigint references user_info(user_id) on delete cascade,
    -- 认证类型，可能是密码、OAuth2、API Key 等。
    pass_type           integer not null references type_value_info(type_value),
    pass_value          text, -- may be null for some credential type.
    pass_salt           text, -- may be null.
    created_at          timestamptz not null default now()
);
create index idx_user_credential_user on user_credential(user_id);
create unique index idx_user_credential_user_pass on user_credential(user_id, pass_type);

-- 用户认证信息的历史记录表。
-- 这个表格用于记录用户认证信息的变更历史，例如密码变更、OAuth2 认证等。
-- 当用户删除认证信息时，删除 user_credential 里面的数据行，同时 user_credential_history 填写 removed_at 字段。
create table user_credential_history(
    pass_id             bigint primary key,
    user_id             bigint references user_info(user_id) on delete cascade,
    pass_type           integer not null references type_value_info(type_value),
    pass_value          text, -- may be null for some credential type.
    pass_salt           text, -- may be null.
    created_at          timestamptz not null default now(),
    removed_at          timestamptz
);

-- 用户登录的历史记录。
create table user_login_history (
    login_activity_id   bigint primary key,
    user_id             bigint references user_info(user_id) on delete cascade,
    login_from_ip       text not null,
    login_server_id     integer not null,
    login_at            timestamptz not null default now(),
    is_success          boolean not null default true
);
create index idx_user_login_id on user_login_history(user_id);

-- 设备信息表
create table device_info (
    device_id           bigint primary key,
    user_id             bigint not null references user_info(user_id) on delete cascade,
    device_type         integer not null references type_value_info(type_value),
    device_serial       text not null,
    registered_at       timestamptz not null default now(),
    is_allowed          boolean not null default true
);
create index idx_device_info_user on device_info(user_id);
create unique index idx_device_info_active on device_info(device_serial) include (device_id, is_allowed);

-- 设备的历史信息表格，它和 device_info 同步更新。
-- 在用户删除设备的时候，删除 device_info 里面的数据行，同时 device_info_history 填写 removed_at 字段。
create table device_info_history (
    device_id           bigint primary key,
    user_id             bigint not null references user_info(user_id) on delete cascade,
    device_type         integer not null references type_value_info(type_value),
    device_serial       text not null,
    registered_at       timestamptz not null default now(),
    removed_at          timestamptz
);

-- 设备的登录历史记录。
create table device_login_history (
    login_activity_id   bigint primary key,
    device_id           bigint references device_info(device_id) on delete cascade,
    login_from_ip       text not null,
    login_server_id     integer not null,
    login_at            timestamptz not null default now(),
    is_success          boolean not null default true
);
create index idx_deivce_login_id on device_login_history(device_id);

-- 设备的注册过程。
create table device_registration(
    registration_id     bigint primary key,
    -- 设备 ID，关联到 device_info 表。
    device_id           bigint references device_info(device_id) on delete cascade,
    -- 设备序列号，通常是设备的唯一标识符，例如 ESP32 EFUSE ID。
    device_serial       text not null,
    registration_code   text not null,
    registration_from_ip text not null,
    registered_at       timestamptz not null default now(),
    valid_until         timestamptz not null default now() + interval '1 hour',
    is_used             boolean not null default false
);
create index idx_device_registration_serial on device_registration(device_serial);
create index idx_device_registration_code on device_registration(registration_code);


-- 聊天会话信息表
create table chat_session (
    chat_id             bigint primary key,
    user_id             bigint not null references user_info(user_id) on delete cascade,
    chat_name           text not null,
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    removed_at          timestamptz
);
create index idx_chat_session_user on chat_session(user_id);

-- 聊天信息分享表
create table chat_share (
    share_id            bigint primary key,
    chat_id             bigint not null references chat_session(chat_id) on delete cascade,
    shared_user_id      bigint not null references user_info(user_id) on delete cascade,
    is_active           boolean not null default true,
    shared_at           timestamptz not null default now(),
    removed_at          timestamptz
);
create unique index idx_chat_share_pair on chat_share(chat_id, shared_user_id) where is_active = true;
create index idx_chat_share_user on chat_share(shared_user_id);

-- 聊天内容表
create table chat_message (
    message_id          bigint primary key,
    chat_id             bigint not null references chat_session(chat_id) on delete cascade,
    message_index       integer not null,
    sender_type         integer not null references type_value_info(type_value),
    -- 发送者的 ID，可能是用户 ID 或者 LLM 角色 ID 甚至是 Tool ID 。
    sender_id           bigint not null,
    -- 消息类型，可能是文本、图片、音频、还有 LLM 过程中的辅助消息例如 Tool Request 等。
    message_type        integer not null references type_value_info(type_value),
    text_content        text,
    text_content_tsv    tsvector, -- 用于全文搜索的文本内容向量
    has_binary          boolean not null default false,
    binary_object_id    bigint references binary_object(object_id) on delete set null,
    binary_object_name  text,
    is_hidden_user      boolean not null default false,
    is_hidden_ai        boolean not null default false,
    is_active           boolean not null default true,
    sent_at             timestamptz not null default now(),
    removed_at          timestamptz
);
create unique index idx_chat_message_chat on chat_message(chat_id, message_index);
create index idx_chat_message_sender on chat_message(sender_type, sender_id);
create index idx_chat_message_object on chat_message(binary_object_id);
create index idx_chat_message_fulltext on chat_message using gin(text_content_tsv);

-- 创建触发器函数，用于在插入或更新时自动更新全文搜索向量
create function chat_message_tsvector_trigger() returns trigger as $$
begin
    new.text_content_tsv := to_tsvector('simple', new.text_content);
    return new;
end;
$$ language plpgsql;
create trigger trg_chat_message_tsvector
    before insert or update on chat_message
    for each row execute function chat_message_tsvector_trigger();

-- 创建触发器函数，设置自增的 message_index，确保 unique(chat_id, message_index) 唯一性约束。
create function chat_message_index_trigger() returns trigger as $$
begin
    if new.message_index is null then
        begin
            -- lock the row with given chat_id and max message_index,
            -- to ensure no concurrent inserts can cause duplicate message_index.
            select message_index into strict new.message_index
            from chat_message
            where chat_id = new.chat_id
            order by message_index desc
            limit 1 for update;
            new.message_index := new.message_index + 1;

            -- if not found, set to 1.
            exception when no_data_found then
                new.message_index := 1;
        end;
    end if;
    return new;
end;
$$ language plpgsql;
create trigger trg_chat_message_index
    before insert on chat_message
    for each row execute function chat_message_index_trigger();


-- LLM 工具信息表
create table llm_tool_info (
    tool_id            bigint primary key,
    tool_type          integer not null references type_value_info(type_value),
    tool_name          text not null,
    tool_definition    jsonb not null,
    created_at         timestamptz not null default now()
);
create unique index idx_tool_info_name on llm_tool_info(tool_name);
create index idx_tool_info_type on llm_tool_info(tool_type);

-- LLM 工具调用记录
create table llm_tool_call (
    call_id            bigint primary key,
    message_id         bigint not null references chat_message(message_id) on delete cascade,
    tool_id            bigint not null references llm_tool_info(tool_id) on delete cascade,
    arguments          jsonb,
    response           jsonb,
    called_at          timestamptz not null default now()
);
create index idx_tool_call_message on llm_tool_call(message_id);
create index idx_tool_call_tool on llm_tool_call(tool_id);

-- LLM 工具调用的二进制对象（如图片、文件等）存储
create table llm_tool_artifact (
    entry_id           bigint primary key,
    call_id            bigint references llm_tool_call(call_id) on delete cascade,
    artifact_id        bigint references binary_object(object_id) on delete cascade,
    artifact_name      text not null,
    is_input           boolean not null default false
);
create unique index idx_tool_artifact_call on llm_tool_artifact(call_id, artifact_id);
create index idx_tool_artifact_id on llm_tool_artifact(artifact_id);

-- LLM 角色信息表
create table llm_avatar_info (
    avatar_id          bigint primary key,
    avatar_name        text not null,
    owner_user_id      bigint not null references user_info(user_id) on delete set null,
    pinned_prompt      text,
    first_message      text,
    avatar_image_id    bigint references binary_object(object_id) on delete set null,
    llm_provider_enum  integer not null references type_value_info(type_value),
    llm_model_name     text not null,
    llm_model_args     jsonb not null,
    tts_provider_enum  integer not null references type_value_info(type_value),
    tts_voice_name     text not null,
    tts_model_args     jsonb not null,
    is_public          boolean not null default false,
    is_active          boolean not null default true,
    created_at         timestamptz not null default now(),
    removed_at         timestamptz
);
create index idx_avatar_info_owner on llm_avatar_info(owner_user_id);
create index idx_avatar_info_public on llm_avatar_info(is_public);

-- LLM 角色分享表
create table llm_avatar_share (
    share_id           bigint primary key,
    avatar_id          bigint not null references llm_avatar_info(avatar_id) on delete cascade,
    shared_user_id     bigint not null references user_info(user_id) on delete cascade,
    is_active          boolean not null default true,
    shared_at          timestamptz not null default now(),
    removed_at         timestamptz
);
create unique index idx_avatar_share_pair on llm_avatar_share(avatar_id, shared_user_id) where is_active = true;
create index idx_avatar_share_user on llm_avatar_share(shared_user_id);

-- 审计日志
create table audit_log (
    log_id             bigint primary key,
    user_id            bigint references user_info(user_id) on delete set null,
    action_type        integer not null references type_value_info(type_value) on delete set null,
    target_type        integer not null references type_value_info(type_value) on delete set null,
    target_id          bigint not null,
    occurred_at        timestamptz not null default now(),
    details            jsonb
);
create index idx_audit_log_user on audit_log(user_id);
create index idx_audit_log_type on audit_log(action_type);

-- 下面两个 Table 是系统全局配置，不是用户会操作到的表格。
-- 设备类型对应可以使用的 LLM 角色列表。
create table llm_avatar_device_type_bind (
    bind_id            bigint primary key,
    device_type        integer not null references type_value_info(type_value),
    avatar_id          bigint not null references llm_avatar_info(avatar_id) on delete cascade,
    is_default         boolean not null default false,
    created_at         timestamptz not null default now()
);
create unique index idx_avatar_device_type_default on llm_avatar_device_type_bind(device_type) where is_default = true;
create unique index idx_avatar_device_type_bind on llm_avatar_device_type_bind(device_type, avatar_id);

-- 设备类型对应可以使用的 LLM 工具列表。


