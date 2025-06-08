-- Verify llm_chat:create_user_table on pg

BEGIN;

select 1 from device_registration limit 1;
select 1 from device_login_history limit 1;
select 1 from device_info_history limit 1;
select 1 from device_info limit 1;
select 1 from user_login_history limit 1;
select 1 from user_credential_history limit 1;
select 1 from user_credential limit 1;
select 1 from user_info limit 1;

ROLLBACK;
