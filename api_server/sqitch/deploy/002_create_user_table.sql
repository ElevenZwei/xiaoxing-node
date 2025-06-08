-- Deploy llm_chat:create_user_table to pg

BEGIN;

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
    registered_at       timestamptz not null default now(),
    valid_until         timestamptz not null default now() + interval '1 hour',
    is_used             boolean not null default false
);
create index idx_device_registration_serial on device_registration(device_serial);
create index idx_device_registration_code on device_registration(registration_code);


COMMIT;
