-- Revert llm_chat:005_insert_root_user from pg

BEGIN;

delete from user_info where user_id = 1;

COMMIT;
