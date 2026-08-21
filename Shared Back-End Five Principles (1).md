Shared Back-End: Five Principles and Entity Graph Cutover
Created: 2026-08-21 Updated: 2026-08-21 Status: Implemented (Git migrations; applied by Supabase GitHub Integration on merge) Owner: Oakbridge Engineering Apps: TOW (apps/ooo) and KB Admin (apps/kb-admin) Rule: .cursor/rules/shared-backend-principles.mdc

Summary
TOW and KB Admin are two screens on one shared back-end. This cutover made that real in Postgres: one Policy Decision Point (PDP), one entity_type enum (DD-11), one edge table, one record-role table, and shared subsystems bound by entity_type + entity_id.

Typed per-app tables were backfilled, dual-written, then dropped. New writes go only to the shared tables. Goals and articles stay separate entities. They are related by graph edges, not by merging the two product objects. Tables that were empty or never queried (dead / unused) were dropped without a merge target — see Dead and unused tables.

Migrations are Git files only. They are not applied via MCP, CLI, or Dashboard.

Why this work happened
Before the cutover, the same ideas were stored many times:

Item owners lived in item_contributors; goal owners lived in goal_contributors.
Item↔goal, item↔item, and goal↔goal each had a junction table.
KB feature overrides lived in kb_user_feature_permissions and were also evaluated in TypeScript.
Article markdown, search, managed files, GitHub snapshots, and ticket comments each had their own tables.
TOW and KB Admin each had (or were about to grow) a local PDP.
That blocked a single agent question — “what is related to this thing, and who can change it?” — because the answer was spread across 14+ junctions and two permission evaluators.

The five principles (and the sixth shared-subsystem rule) are the contract that stops that from returning.

The five principles (plus shared-first)
These match the product slides and the workspace rule. The rule numbers the shared-subsystem rule as point 6.

#	Principle	Backend meaning
1	One shared back-end	One database. One SQL PDP (can_user_manage_*). Apps inject a Supabase client into @theoakbridgeway/authorization. Do not add lib/pdp evaluators or copy the KB waterfall between apps.
2	Shared-first	Comments, tags, field history, notifications, files, and retrieval bind by entity_type + entity_id. Consume the shared surface; do not remodel it per app.
3	One universal entity graph	One public.entity_type enum (DD-11). One entity_relationships edge table. Any entity can relate to any other, labeled by relationship_type. Optional payload goes in metadata JSONB.
4	One record-role table	entity_contributors is the only Level 3 owner / contributor / RACI table (entity_type + entity_id + user_id + record_role).
5	One layered permission vocabulary	Level 1 system role → Level 2 app role (kb_role, team_members / roster) → Level 3 record. Overrides only in user_permission_grants. One SQL waterfall. TypeScript stays an RPC adapter.
Intentionally not merged

goals and articles stay separate tables.
user_profiles.kb_role and team roster stay Level 2. They are not folded into user_permission_grants.
kb_access_grants stays (Level 2 knowledge-base assignment).
teams.owner_id stays (team identity, not a graph edge).
Storage bucket documents stays (file bytes). Locators may later be adls://… after a real Azure upload.
Entity test (what belongs on the graph)
A row is an entity when all of these are true. Otherwise it is a direct 1:M child of a parent.

Test	Entity (yes)	Direct 1:M child (no)
Independent identity	Means something without its parent (goal, article, team)	Meaningless without parent (article_content was this; files_versions still is)
Polymorphic reachability	Many types point at it, or it points at many types	One typed FK to one parent
Cross-cutting participation	Needs tags, entity_relationships, or entity_contributors	No
Own lifecycle	Created, owned, audited on its own	Lives and dies with the parent write
Agent-addressable	An agent would ask “what is related / who owns this?”	Reached only through the parent
Entities on public.entity_type (DD-11 Part B), foundation set

knowledge_base, hierarchy_node, article, vendor, glossary_entry, supplemental_knowledge, asset, tag, knowledge_gap, chat_session, cascading_message, headline, standard, note, goal, item, team, meeting, todo, meeting_transcript, meeting_notes, email_thread, chat_thread

Values added later

Value	Migration	Why
ticket	20260819210000_am_content_asset_graph.sql	TOW tickets participate in comments, files, and article edges. tow_tickets stays; tickets are not merged with goals or articles.
strategic_pillar	20260820200000_entity_type_strategic_pillar.sql	Goal→pillar categorized_under edges need a real discriminator.
user	20260821030000_entity_type_user.sql	Meeting attendance and votes are edges to a person.
Still children (not entities)

markdown_content / historical article_content — body of an article
files / files_versions — bytes and versions of an asset
content_sections — retrieval chunks of indexed content
Compatibility views that only exist so old SQL names keep working
Target backend schema
public.entity_type
Cross-table discriminator. New polymorphic columns must use this enum, not a CHECK of ad-hoc strings.

public.entity_relationships
Universal edge table.

Column	Role
source_entity_type / source_entity_id	Polymorphic source
target_entity_type / target_entity_id	Polymorphic target
relationship_type	Discriminates the edge (related, visible_to, voted, …). Text until a dedicated enum ships.
metadata	JSONB, default {}. Delivery status, vote type, movement workflow, measurement values.
notes	Optional human label (for example transfer-target label)
created_by / updated_by / timestamps	Audit
Unique on (source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type).

Goal↔goal pairs are stored undirected: smaller UUID is source. A unique index on LEAST/GREATEST of the two IDs prevents A→B and B→A duplicates.

Item-movement instances are excluded from that uniqueness so the same item can move to the same team more than once.

public.entity_contributors
Level 3 record roles.

Column	Role
entity_type / entity_id	Which record
user_id	Who
record_role	contributor, team roster role, RACI, etc.
is_active / is_protected	Soft state
added_by / updated_by / timestamps	Audit
Unique on (entity_type, entity_id, user_id).

Shared subsystems
Subsystem	Table	Bind
Tags	entity_tags	tag_id + entity_type + entity_id. Not folded into entity_relationships.
Comments	comments	Must populate entity_type + entity_id. Legacy item_id / goal_id may still be filled.
Field history	field_history	entity_type + entity_id + field diffs / events
Notifications	notifications	entity_type + entity_id + type / metadata.source
Published markdown	markdown_content	entity_type + entity_id, is_published, record_kind
Search / retrieval	content_index, content_sections	Polymorphic content; embeddings optional (section_embedding)
Files	assets, files, files_versions	Asset is the entity; files are versions. Edges from asset → article / KB / vendor.
Permission backend (principles 1 and 5)
Single SQL waterfall
Authority lives in Postgres:

can_user_manage_item / _with_reason
can_user_manage_goal / _with_reason (and hierarchy / pillars / team-association helpers)
can_user_manage_kb / _with_reason
can_user_manage_team, meeting, headline, standard, ticket, cascading-message helpers
user_can_manage_todo
If a check is missing, it is added to SQL first. TypeScript does not grow a second waterfall.

KB hierarchy and knowledge-base assignment scope (kb_access_grants) are evaluated inside can_user_manage_kb_with_reason when p_entity_type + p_entity_id are passed.

Unscoped KB read means “all authenticated users.” App entry (KB Admin layout, TOW browse) uses operation browse, not read.

Shared package
@theoakbridgeway/authorization is the only PDP implementation. It is an RPC adapter: apps pass a Supabase client.

App file	Role
apps/ooo/lib/pdp/*.ts	Thin re-export or client injection
apps/kb-admin/src/lib/pdp/kb.ts	Injects KB service client into evaluateKbSqlPermission
packages/authorization/src/pdp/kb.ts	Shared can_user_manage_kb_with_reason adapter
composeDecision in the package documents grant-vs-waterfall precedence. It is a test/documentation aid. Live deny/allow still happens in SQL (user_permission_grants then the waterfall).

Overrides
Layer	Store	Do not
Allow / deny override	user_permission_grants	Recreate kb_user_feature_permissions
KB assignment scope	kb_access_grants	Fold into grants
KB app role	user_profiles.kb_role	Fold into grants
Team membership	roster on entity_contributors (entity_type = team) after cutover	Fold into grants
Feature flags: inherited from Super Admin / kb_role, then user_permission_grants. Reason code KB_FEATURE_DENIED. Table kb_user_feature_permissions was dropped.

What we merged, with whom, and why
Each row is “old table or path → surviving shared table.” Why is the principle that made the merge mandatory.

A. Record roles → entity_contributors
Merged from	Merged into	Mapping	Why
item_contributors	entity_contributors	entity_type = item, entity_id = item_id, record_role from RACI / contributor	Principle 4. Same “this user has a role on this record.”
goal_contributors	entity_contributors	entity_type = goal	Same.
team_members	entity_contributors	entity_type = team, record_role = role, added_at = joined_at	Roster is a Level 3 record role on a team, not a second membership product.
Compatibility views + INSTEAD OF triggers keep SQL that still names team_members working after the drop.

B. Entity↔entity edges → entity_relationships
Merged from	Source → target	relationship_type	Why
item_goal_relationships	item → goal	stored type (related, converted_to_rock, …); metadata kept	One graph. Item goal_id may still exist as a convenience FK and is synced to a related edge.
item_relationships	item → item (directed)	stored type (merged_from, linked_to, …)	Same shape as every other edge.
goal_relationships	goal → goal (undirected; smaller UUID = source)	related	Non-directional pair; unique on the unordered pair.
goal_team_associations	goal → team	visible_to	Related-team visibility is an edge, not a private junction.
goal_strategic_pillar_jt	goal → strategic_pillar	categorized_under	Required adding strategic_pillar to the enum.
vendor_relationships	vendor → related entity	stored vendor types	KB vendor links are graph edges.
standards_teams	standard → team	assigned_to	Assignment is an edge.
cascading_messages_teams	cascading_message → team	delivered_to	Delivery state in metadata.
headlines_teams	headline → team	shared_with	Same; share/complete timestamps in metadata.
cascading_messages_meetings	cascading_message → meeting	presented_at	Presentation link.
headlines_meetings	headline → meeting	presented_at	Same.
meeting_team_associations	meeting → team	visible_to	Meeting visibility to a team.
data_dictionary_tags	glossary_entry → measured entity	measures	Measurement values (value/target) are edge metadata. Labels stay on entity_tags / tags.
team_transfer_targets	team → team	can_transfer_to	Allow-list of where items may move. Label in notes; metadata.is_active. Not the same as a movement instance.
meeting_attendees	meeting → user	attendee / facilitator / note_taker	Attendance is an edge to a person. Required entity_type = user.
item_votes	user → item	voted	Vote type in metadata. item_vote_resets stays.
item_movements	item → team	item_movement	Lifecycle instance (when it moved), not the allow-list. Workflow columns in metadata; comment in notes. Partial unique index excludes this type so repeats are allowed.
entity_article_links	goal / item / ticket → article	article-link types	Typed article junction replaced by the graph.
Ticket / asset / GitHub article links	asset → article / knowledge_base / vendor / hierarchy_node	informs, scoped_to, …	Files and tickets attach through the same graph.
Why not 14 tables: every junction was (source type+id) → (target type+id) + type + optional payload. Agents and RLS need one query shape, one unique constraint, one policy family.

C. Tags → entity_tags
Merged from	Mapping	Why
item_tags	entity_type = item	Tags are labels on a record, not edges between two business entities. entity_tags stays; it is not folded into entity_relationships.
D. Content, files, search
Merged from	Merged into	Why
article_content + article_versions	markdown_content (is_published, record_kind = publish / restore_draft; title/metadata snapshots on the row)	One published-markdown store for TOW and KB.
kb_managed_documents + versions + links	assets / files / files_versions + entity_relationships	A managed file is an asset with versions, not a KB-only document type.
documents + document_chunks	content_index + content_sections (match_content_sections)	One retrieval index. Embeddings optional.
github_article_versions	markdown_content (created_via = github_sync)	A GitHub snapshot is a markdown version.
github_documents + github_import_history	assets / files / files_versions + field_history (change_type = github_import)	Imported GitHub files are files. Import events are history. Connections, repos, PRs, jobs stay.
tow_ticket_attachments	assets / files / files_versions + edges	Ticket files use the shared file model. Bucket documents path prefix tickets/ stays.
AM.8 (later): normalize extracted files to .md beside the original and promote to markdown_content on publish. Do not create extracted_content. File locators: github:{source_key}:{path} for GitHub; adls://account/container/path only after a successful Azure upload; local fallback supabase://documents/….

E. Comments, activity, notifications, logs
Merged from	Merged into	Why
tow_ticket_comments	comments (entity_type = ticket)	One comment table.
tow_ticket_activity	field_history	Activity is a field/event log on the ticket.
kb_content_notifications, github_sync_notifications, kb_engineering_notifications	notifications	One inbox (entity_type + entity_id + type / metadata.source). notification_preferences stays.
goal_audit_log	field_history (change_type = goal_field)	Same “this field changed” record.
article_attachment_history	field_history (change_type = article_moved)	Hierarchy node moves are a field change on articles.hierarchy_node_id.
goal_progress_history, audit_logs, and permission_audit_log stay (progress snapshots vs security/ops vs permission decisions).

F. Unused / leftover tables (dropped, not merged)
These had no surviving product path. Full inventory is in Dead and unused tables.

Dropped	Why no merge target
goal_parents	Emptied when goal_relationships shipped; that table then merged into entity_relationships.
content_audits	Never queried.
raw_articles + articles.raw_article_id	Unfinished intake. New intake needs a new design.
ui_content, ui_content_versions, ui_content_audit	Empty after copy to article_content / article_versions.
kb_user_feature_permissions	Overrides already live in user_permission_grants.
kb_ticket_article_links and unused kb_engineering_* connector tables	Ticket-simulator persistence only. OOO tow_tickets and kb_article_usage_events stay.
article_operating_logic	Dormant workflow-era companion (0 rows, no app writes).
Dropped tables (inventory)
Grouped by cutover migration. Recreating any of these is a regression.

2026-08-18 — unused leftovers
Migration: 20260818121000_drop_unused_goal_parents_content_audits_raw_articles.sql

goal_parents
content_audits
raw_articles
2026-08-19 — first graph cutover
Migration: 20260819160000_cutover_entity_graph_drop_typed_tables.sql

item_contributors
goal_contributors
item_goal_relationships
item_tags
Dual-write triggers sync_*_to_entity were dropped in the same file after backfill.

2026-08-19 — pair edges
Migration: 20260819180000_cutover_item_goal_pair_edges.sql

item_relationships
goal_relationships
2026-08-19 — KB feature overrides
Migration: 20260819200000_drop_kb_user_feature_permissions.sql

kb_user_feature_permissions
2026-08-19 — article content compatibility
Migration: 20260819210300_drop_article_content_compat.sql

entity_article_links
article_versions
article_content
2026-08-19 — assets / search / GitHub snapshots
Migration: 20260819210400_cutover_assets_search_github.sql

kb_managed_document_links
kb_managed_document_versions
kb_managed_documents
document_chunks
documents (table; Storage bucket documents stays)
github_article_versions
2026-08-19 — ticket shared subsystems
Migration: 20260819210600_cutover_ticket_shared_subsystems.sql

tow_ticket_attachments
tow_ticket_comments
tow_ticket_activity
tow_tickets stays.

2026-08-20 — feature inboxes, GitHub file identity, typed junctions
Migrations: 20260820180000_merge_feature_notifications.sql, 20260820190000_merge_github_documents_into_assets.sql, 20260820200100_merge_typed_junctions_into_entity_relationships.sql, plus 20260820164500_drop_kb_ticket_article_links.sql

kb_content_notifications
github_sync_notifications
kb_engineering_notifications (also with ticket-simulator drop)
kb_engineering_audit_events
kb_engineering_sync_jobs
kb_engineering_timeline_events
kb_engineering_links
kb_engineering_connections
kb_ticket_article_links
github_documents
github_import_history
goal_team_associations
goal_strategic_pillar_jt
vendor_relationships
standards_teams
cascading_messages_teams
headlines_teams
cascading_messages_meetings
headlines_meetings
meeting_team_associations
data_dictionary_tags
goal_audit_log
article_attachment_history
2026-08-21 — transfer targets, roster, votes, movements
Migrations: 20260821010000_merge_team_transfer_targets_into_entity_relationships.sql, 20260821030100_merge_membership_votes_movements.sql

team_transfer_targets
team_members (compatibility view may remain)
meeting_attendees
item_votes
item_movements
Dead and unused tables
Dead / unused means: zero (or only leftover) application consumers, and the table was not a live junction that we folded into entity_relationships / entity_contributors. Merged tables are in the sections above. Do not recreate any table in this section.

Already dropped — unused (no merge)
Table	Why it was dead	Dropped
goal_parents	Replaced by goal_relationships (2026-02). App code stopped writing it. Two SQL functions (calculate_goal_health, update_parent_goal_child_count) still read it until the drop migration rewrote them. Then goal_relationships itself merged into entity_relationships. TD-018.	2026-08-18 — 20260818121000_drop_unused_goal_parents_content_audits_raw_articles.sql
content_audits	AI/automated content-audit findings. Never queried by TOW or KB Admin.	Same 2026-08-18 migration
raw_articles	Unfinished email/form intake (30+ columns, 0 rows). No .from('raw_articles') in apps.	Same 2026-08-18 migration
articles.raw_article_id	FK column to raw_articles. Unused.	Same 2026-08-18 migration (column, not a table)
ui_content	Old KB name. Data copied to article_content (20260514181830). 0 remaining rows. SC-004.	2026-05-14 — 20260514220322_drop_deprecated_ui_content_tables.sql
ui_content_versions	Child of ui_content; data copied to article_versions. SC-005.	Same 2026-05-14 migration
ui_content_audit	Unused audit of the old UI-content table. SC-006.	Same 2026-05-14 migration
workflow_content	Baseline leftover after workflows → articles. 0 rows. Superseded by article_content. SC-007.	Absent from current generated types; do not recreate. article_content later dropped in the markdown cutover.
workflow_versions	Same leftover as workflow_content. SC-008.	Same as above
kb_user_feature_permissions	Feature overrides moved to user_permission_grants. Table became unread.	2026-08-19 — 20260819200000_drop_kb_user_feature_permissions.sql
kb_ticket_article_links	Ticket-simulator article links. Not OOO tow_tickets.	2026-08-20 — 20260820164500_drop_kb_ticket_article_links.sql
kb_engineering_notifications	Ticket-simulator inbox. Folded conceptually into notifications, but the simulator itself was unused.	Same ticket-simulator drop / notification merge
kb_engineering_audit_events	Ticket-simulator audit. No TOW/KB product consumer.	Same
kb_engineering_sync_jobs	Ticket-simulator jobs.	Same
kb_engineering_timeline_events	Ticket-simulator timeline.	Same
kb_engineering_links	Ticket-simulator links.	Same
kb_engineering_connections	Ticket-simulator connections.	Same
article_operating_logic (also historically workflow_operating_logic)	RACI/SLA/escalation companion for articles. 0 rows. No app .from('article_operating_logic'). SC-051. Concept may return as a new design, not this schema.	Planned / local 20260820170000_drop_article_operating_logic.sql
strategic_pillars.test_column	CI placeholder column. No app use.	2026-08-17 — 20260817180000_drop_strategic_pillars_test_column.sql (column only)
Still in generated schema — unused or dormant
These still appear in packages/types (or a drop file is not yet on every environment). Do not write new features to them.

Table	Status	Why unused	What to do
article_operating_logic	Still in database.generated.ts until the drop migration is applied everywhere	Zero app writes. Workflow-era 1:1 child of articles.	Drop via Git migration. Do not add UI on this table.
llm_settings	Deprecated, not fully dead (TD-063)	Replaced as the design source of truth by LangSmith. KB Admin src/lib/settings.ts and /api/settings still read/write it.	Do not add new LLM config keys here. Drop only after those routes move to LangSmith.
workflow_content / workflow_versions	Baseline CREATE exists; not in current generated types	Empty leftovers after article rename	Do not recreate. Do not query.
Platform-admin tables (workflow_maps, decision_rights, responsibility_rules, exception_overrides, org_roles, obie_personas, mcp_servers) are not dead — apps/platform-admin reads them. chat_sessions / chat_interactions are live KB Admin chat/observability tables.

Written but not used as a product surface
Table	Writes	Reads in app UI	Notes
audit_logs	Item move / elevate / transfer / reject, impersonation	GET /api/audit-logs exists; no dashboard or settings page consumes it. Activity feed uses field_history + comments.	Keep for security/ops. Do not drop as part of the entity-graph cutover.
permission_audit_log	Permission decision logging	Admin/ops, not end-user product	Keep.
Unused columns (related)
Column	Table	Why unused	Disposition
raw_article_id	articles	Intake never shipped	Dropped 2026-08-18
test_column	strategic_pillars	CI leftover	Dropped 2026-08-17
Dormant workflow-era articles columns (SC-060–SC-076)	articles	Not shown in current KB Admin UI; embedding pipeline planned drops	Validate before drop; not part of the graph merge
How this differs from merged tables
Kind	Example	Action we took
Dead / unused	content_audits, raw_articles, ui_content	DROP. No backfill.
Merged	item_contributors → entity_contributors	Backfill, dual-write, then DROP.
Stays unused-looking but intentional	audit_logs	Keep. Not a graph table.
Tables and columns that stay (do not drop)
Stay	Reason
goals, articles	Separate products; related only by edges
tow_tickets	Ticket entity; comments/files moved off satellite tables
kb_access_grants	Level 2 KB assignment
user_profiles.kb_role	Level 2 KB role
teams.owner_id	Team identity
item_vote_resets	Reset events, not votes
goal_progress_history	Paired progress + next-step snapshots
audit_logs, permission_audit_log	Security / permission decision logs
notification_preferences	Email prefs, not the inbox
entity_tags, tags	Labels, not edges
github_connections, github_repositories, github_webhooks, github_pull_requests, github_sync_jobs, github_path_mappings	Integration state, not file identity
Storage bucket documents	File bytes until locators fully move
kb_article_usage_events	Analytics; not ticket-simulator links
Migration sequence (backend)
Apply order is the filename timestamp. Dual-write first, drop second. Never skip the backfill.

Migration	What it does
20260818121000_drop_unused_goal_parents_content_audits_raw_articles.sql	Drop unused leftovers
20260819130000_shared_backend_foundation.sql	Create entity_type, entity_contributors, entity_relationships; comment polymorphic columns; dual-write + backfill from item/goal contributors, item–goal edges, item tags; start SQL KB waterfall
20260819143000_kb_feature_flags_sql_and_grants_dual_write.sql	Feature flags in SQL; dual-write old feature table → grants
20260819160000_cutover_entity_graph_drop_typed_tables.sql	Write RLS/audit on entity_*; drop first typed set
20260819170000_kb_feature_overrides_grants_only.sql	Stop reading kb_user_feature_permissions
20260819180000_cutover_item_goal_pair_edges.sql	Backfill item–item and goal–goal; drop those junctions
20260819190000_kb_scope_in_sql_waterfall.sql	kb_access_grants scope inside SQL
20260819200000_drop_kb_user_feature_permissions.sql	Drop feature-override table
20260819210000_am_content_asset_graph.sql	markdown_content, content_index, content_sections, assets, files, files_versions; add ticket enum; dual-write from article/managed-doc tables
20260819210100_am_ticket_article_edges.sql	Ticket/article edges on the graph (after enum commit)
20260819210200_markdown_content_app_sot.sql	Apps treat markdown_content as source of truth
20260819210300_drop_article_content_compat.sql	Drop article content / versions / article-link table
20260819210400_cutover_assets_search_github.sql	Fold search/managed-doc/GitHub snapshots; drop those tables
20260819210500_file_format_images.sql	Image file_format values
20260819210600_cutover_ticket_shared_subsystems.sql	Ticket comments/activity/attachments → shared tables
20260820164500 / 20170000 / 20180000 / 20190000	Ticket-simulator and operating-logic drops; notification merge; GitHub file identity → assets
20260820200000 / 20200100	strategic_pillar enum; remaining typed junctions → graph
20260821010000	Transfer targets → can_transfer_to
20260821020000_kb_browse_sql_pdp.sql	SQL browse for KB Admin / TOW reader
20260821030000 / 030100	user enum; roster / attendees / votes / movements
20260821040000_adls_am8_file_normalize.sql	ADLS locator + AM.8 markdown normalize
Remote apply: Supabase GitHub Integration on PR merge to staging, then main. Verify with read-only MCP (list_migrations, SELECT only).

App-side backend adapters (not a second database)
Change	Where	Why
Shared PDP package	packages/authorization	Principle 1
TOW / KB lib/pdp/kb.ts	RPC into evaluateKbSqlPermission	Same KB waterfall on both screens
TOW item/goal/meeting/headline/standard/ticket/team PDP	Re-export from the package	No per-app evaluator
Assistant grounding / retrieve / cache / rerank	packages/utils/src/kb/assistant/	Principle 2 — not a KB Admin fork
API writes for links, tags, contributors	.from("entity_relationships"), entity_tags, entity_contributors	Principles 3–4
Nested apps/kb-admin/supabase/	Removed	One migration chain at repo root
Entity flow (how a write travels)
App (TOW or KB Admin)
  → PEP (lib/pep or route guard)
    → PDP adapter (@theoakbridgeway/authorization)
      → SQL can_user_manage_*(user, id, operation)
        → L1 system role
        → user_permission_grants deny/allow
        → L2 kb_role / team roster
        → L3 entity_contributors / ownership
        → entity-specific rules (hierarchy, kb_access_grants, public list, …)

Allowed write
  → entity row (goals, articles, items, …)
  → optional entity_relationships edge
  → optional entity_contributors role
  → optional entity_tags / comments / field_history / notifications
  → optional markdown_content / assets
Example: link an item to a goal

PEP checks can_user_manage_item / can_user_manage_goal for the operation.
Insert entity_relationships (item → goal, type related or converted_to_rock).
Do not insert into item_goal_relationships (dropped).
Example: add a team member

Check team update via SQL (can_user_manage_team / grants).
Insert entity_contributors (entity_type = team, record_role = Owner/Admin/Member).
Do not insert into team_members (dropped; compatibility view may rewrite).
Do not
Recreate any table in the dropped inventory.
Add a new *_contributors or junction table.
Evaluate permissions only in TypeScript, or copy KB hierarchy ordinals in the app.
Fold kb_role or team roster into user_permission_grants.
Drop kb_access_grants.
Fold entity_tags into entity_relationships.
Merge goals with articles.
Store movement instances on can_transfer_to edges (allow-list vs lifecycle).
Invent adls:// URLs without a successful upload.
Apply these migrations via MCP apply_migration, Supabase CLI, or Dashboard.
Source documents
Document	Role
.cursor/rules/shared-backend-principles.mdc	Must-follow contract
.cursor/rules/permission-evaluation-source-of-truth.mdc	SQL is live PDP authority
docs/03_registers/replaced-approaches.md	Old artifact → replacement register
docs/00_ideas/universal-entity-relationships-table.md	Original 14-junction inventory
packages/authorization	Shared PDP adapters
supabase/migrations/20260819*.sql and later 20260820* / 20260821*	Deployment record
Related feature docs: contributors, related items, merge-item-with-goal, visibility architecture, permission architecture.