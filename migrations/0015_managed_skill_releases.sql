create table if not exists skill_releases (
  id text primary key,
  version text not null,
  channel text not null,
  status text not null default 'draft',
  min_client_version text not null,
  release_notes text not null default '',
  codec_version integer not null,
  skill_count integer not null,
  encoded_file_count integer not null,
  manifest_summary jsonb not null default '{}'::jsonb,
  artifact bytea not null,
  artifact_sha256 text not null,
  artifact_size bigint not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (version, channel),
  check (channel in ('dev', 'beta', 'stable')),
  check (status in ('draft', 'published', 'archived')),
  check (codec_version > 0),
  check (skill_count > 0),
  check (encoded_file_count > 0),
  check (artifact_size > 0)
);

create unique index if not exists idx_skill_releases_one_published_per_channel
  on skill_releases (channel)
  where status = 'published';

create index if not exists idx_skill_releases_created
  on skill_releases (created_at desc);

comment on table skill_releases is
  'Immutable, AES-GCM protected Alpha Studio Skill release bundles. Publishing an older row performs a rollback.';
