-- Deploy llm_chat:create_basic_table to pg

BEGIN;

-- 用户类型/值定义表（不常查询，仅启动加载）
create table type_value_info (
    type_value          integer primary key,
    type_name           text not null,
    type_meaning        text not null,
    mime_type           text
);

-- 二进制对象存储表
create table binary_object (
    object_id           bigint primary key,
    file_type           integer not null references type_value_info(type_value),
    file_size           bigint not null,
    storage_path        text not null,
    created_at          timestamptz not null default now()
);
create unique index idx_binary_object_path on binary_object(storage_path);
create index idx_binary_object_type on binary_object(file_type);


COMMIT;
