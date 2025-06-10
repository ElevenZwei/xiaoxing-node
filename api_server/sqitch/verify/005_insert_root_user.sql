-- Verify llm_chat:005_insert_root_user on pg

BEGIN;

select count(*) = 1 as verified from user_info where user_id = 1 and user_name = 'root' and user_type = 8193;

insert into chat_session(
    chat_id, user_id, chat_name
) values (
    0x11100, 1, 'Test Chat'
);
select count(*) = 1 as verified from chat_session where chat_id = 0x11100 and user_id = 1 and chat_name = 'Test Chat';

-- test trigger functions
insert into chat_message(
    message_id, chat_id, sender_type, sender_id, message_type, text_content
) values (
    0x11101, 0x11100, 0x4001, 1, 0x1, 'Test message'
);
select count(*) = 1 as verified from chat_message where message_id = 0x11101 and chat_id = 0x11100 and sender_type = 16385 and sender_id = 1 and text_content = 'Test message';
select text_content_tsv = to_tsvector('simple', 'Test message') as verified from chat_message where message_id = 0x11101;
select message_index = 1 as verified from chat_message where message_id = 0x11101;

ROLLBACK;
