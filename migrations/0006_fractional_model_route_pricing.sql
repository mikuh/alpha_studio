do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'model_routes'
      and column_name = 'input_cents_per_million'
  ) then
    alter table model_routes rename column input_cents_per_million to input_yuan_per_million;
    alter table model_routes
      alter column input_yuan_per_million type double precision using input_yuan_per_million::double precision / 100.0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'model_routes'
      and column_name = 'output_cents_per_million'
  ) then
    alter table model_routes rename column output_cents_per_million to output_yuan_per_million;
    alter table model_routes
      alter column output_yuan_per_million type double precision using output_yuan_per_million::double precision / 100.0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'model_routes'
      and column_name = 'reasoning_cents_per_million'
  ) then
    alter table model_routes rename column reasoning_cents_per_million to reasoning_yuan_per_million;
    alter table model_routes
      alter column reasoning_yuan_per_million type double precision using reasoning_yuan_per_million::double precision / 100.0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'model_routes'
      and column_name = 'cached_input_cents_per_million'
  ) then
    alter table model_routes rename column cached_input_cents_per_million to cached_input_yuan_per_million;
    alter table model_routes
      alter column cached_input_yuan_per_million type double precision using cached_input_yuan_per_million::double precision / 100.0;
  end if;
end $$;
