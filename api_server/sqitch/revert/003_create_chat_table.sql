-- Revert llm_chat:create_chat_table from pg

BEGIN;

-- 审计日志
drop table if exists audit_log;

-- LLM 角色分享表
drop table if exists llm_avatar_share;

-- LLM 角色信息表
drop table if exists llm_avatar_info;

-- LLM 工具调用的二进制对象
drop table if exists llm_tool_artifact;

-- LLM 工具调用记录
drop table if exists llm_tool_call;

-- LLM 工具信息表
drop table if exists llm_tool_info;

-- 聊天内容表
drop table if exists chat_message;
drop function if exists chat_message_tsvector_trigger();
drop function if exists chat_message_index_trigger();

-- 聊天信息分享表
drop table if exists chat_share;

-- 聊天会话信息表
drop table if exists chat_session;

COMMIT;
