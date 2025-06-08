-- Verify llm_chat:create_chat_table on pg

BEGIN;

select 1 from audit_log limit 1;
select 1 from llm_avatar_share limit 1;
select 1 from llm_avatar_info limit 1;
select 1 from llm_tool_artifact limit 1;
select 1 from llm_tool_call limit 1;
select 1 from llm_tool_info limit 1;
select 1 from chat_message limit 1;
select 1 from chat_share limit 1;
select 1 from chat_session limit 1;

ROLLBACK;
