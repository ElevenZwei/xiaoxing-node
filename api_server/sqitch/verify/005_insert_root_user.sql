-- Verify llm_chat:005_insert_root_user on pg

BEGIN;

select count(*) = 1 as verified from user_info where user_id = 1 and user_name = 'root' and user_type = 8193;

ROLLBACK;
