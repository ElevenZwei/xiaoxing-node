-- Verify llm_chat:create_basic_table on pg

BEGIN;

select 1 from type_value_info limit 1;
select 1 from binary_object limit 1;

ROLLBACK;
