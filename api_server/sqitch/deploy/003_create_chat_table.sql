-- Deploy llm_chat:create_chat_table to pg

BEGIN;

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

create table chat_message_counter (
  chat_id       bigint primary key,
  current_index integer not null
);

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
create or replace function chat_message_index_trigger() returns trigger as $$
declare
    next_index integer;
begin
    if new.message_index is null then
        update chat_message_counter
        set current_index = current_index + 1
        where chat_id = new.chat_id
        returning current_index into next_index;

        if not found then
            begin
                next_index := 1;
                insert into chat_message_counter(chat_id, current_index)
                values (new.chat_id, next_index);
            exception when unique_violation then
                update chat_message_counter
                set current_index = current_index + 1
                where chat_id = new.chat_id
                returning current_index into next_index;
            end;
        end if;

        new.message_index := next_index;
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

COMMIT;
