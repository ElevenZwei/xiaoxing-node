-- Deploy llm_chat:005_insert_root_user to pg

BEGIN;

insert into user_info(user_id, user_name, user_type, user_email, user_locale) values
(1, 'root', 0x2001, 'root@root.com', 'en.US');

COMMIT;
