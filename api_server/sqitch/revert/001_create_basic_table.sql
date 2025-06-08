-- Revert llm_chat:create_basic_table from pg

BEGIN;

-- 二进制对象存储表
drop table if exists binary_object;

-- 类型/值表
drop table if exists type_value_info;

COMMIT;
