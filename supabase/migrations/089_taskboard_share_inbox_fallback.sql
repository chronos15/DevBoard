-- TaskBoard V134 - fallback persistente para anexos recebidos via Web Share Target
-- Evita "0 itens" quando o navegador abre /share-target antes do service worker
-- estar controlando a instalação PWA.
begin;

insert into storage.buckets(id, name, public, file_size_limit)
values ('taskboard-share-inbox','taskboard-share-inbox',false,209715200)
on conflict(id) do update set public=false, file_size_limit=209715200;

drop policy if exists taskboard_share_inbox_select on storage.objects;
create policy taskboard_share_inbox_select
on storage.objects for select to authenticated
using (
  bucket_id='taskboard-share-inbox'
  and split_part(name,'/',1)=auth.uid()::text
);

drop policy if exists taskboard_share_inbox_insert on storage.objects;
create policy taskboard_share_inbox_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='taskboard-share-inbox'
  and split_part(name,'/',1)=auth.uid()::text
);

drop policy if exists taskboard_share_inbox_delete on storage.objects;
create policy taskboard_share_inbox_delete
on storage.objects for delete to authenticated
using (
  bucket_id='taskboard-share-inbox'
  and split_part(name,'/',1)=auth.uid()::text
);

commit;
