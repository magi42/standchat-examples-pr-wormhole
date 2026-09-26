// Hookline's app directory: the invented apps the omnibox searches, their
// triggers and actions, and the flow templates that replies can hand out.
// Every app here is made up. Icons are drawn from `look` by icons.js.
//
// A trigger that ends in "*" is instant (the app pushes events to Hookline);
// the others are checked on a schedule. Built-in tools are Hookline's own.

export const CATEGORIES = [
  { id: 'builtin', label: 'Built-in tools', chip: 'Built-in' },
  { id: 'crm', label: 'CRM & sales', chip: 'CRM' },
  { id: 'forms', label: 'Forms & surveys', chip: 'Forms' },
  { id: 'email', label: 'Email', chip: 'Email' },
  { id: 'chat', label: 'Team chat', chip: 'Chat' },
  { id: 'sheets', label: 'Spreadsheets & databases', chip: 'Sheets' },
  { id: 'projects', label: 'Projects & tasks', chip: 'Projects' },
  { id: 'calendar', label: 'Calendar & booking', chip: 'Calendar' },
  { id: 'payments', label: 'Payments & accounting', chip: 'Payments' },
  { id: 'commerce', label: 'E-commerce', chip: 'Commerce' },
  { id: 'marketing', label: 'Marketing', chip: 'Marketing' },
  { id: 'support', label: 'Support', chip: 'Support' },
  { id: 'dev', label: 'Developer tools', chip: 'Dev' },
  { id: 'files', label: 'Files & docs', chip: 'Files' },
  { id: 'hr', label: 'HR & recruiting', chip: 'HR' },
  { id: 'ai', label: 'AI', chip: 'AI' },
  { id: 'analytics', label: 'Analytics', chip: 'Analytics' },
  { id: 'phone', label: 'Phone & SMS', chip: 'Phone' },
  { id: 'social', label: 'Social & community', chip: 'Social' },
  { id: 'video', label: 'Video & events', chip: 'Video' },
];

const app = (id, name, category, blurb, [color, glyph], triggers, actions, keywords = '') => ({
  id,
  name,
  category,
  blurb,
  color,
  glyph,
  triggers: triggers.map((t) => ({ name: t.replace(/\*$/, ''), instant: t.endsWith('*') })),
  actions,
  keywords,
});

const ORANGE = '#FF4F00';

export const APPS = [
  // Built-in tools: the universal fallback when an app isn't in the directory yet.
  app('webhooks', 'Webhooks', 'builtin', 'Catch data from any app that sends webhooks, or send your own.', [ORANGE, 'hook'],
    ['Catch hook*', 'Catch raw hook*'], ['Send POST', 'Send PUT', 'Send GET'], 'api hook callback json payload endpoint custom integration'),
  app('http', 'HTTP request', 'builtin', 'Call any REST API with headers, auth and a JSON body.', [ORANGE, 'braces'],
    ['New response from endpoint'], ['Make a request', 'Download a file', 'Run a GraphQL query'], 'api rest http get post endpoint curl graphql custom integration'),
  app('timer', 'Timer', 'builtin', 'Start a flow every hour, day, week or month.', [ORANGE, 'clock'],
    ['Every hour', 'Every day', 'Every week', 'Every month'], [], 'schedule cron recurring daily weekly hourly morning'),
  app('filter', 'Filter', 'builtin', 'Let a run continue only when your rules match.', [ORANGE, 'funnel'],
    [], ['Only continue if'], 'condition rule if only when'),
  app('branches', 'Branches', 'builtin', 'Send each run down a different path, by rules you set.', [ORANGE, 'branch'],
    [], ['Split into branches'], 'paths if else router switch conditional logic'),
  app('delay', 'Delay', 'builtin', 'Pause a run for a while, or until a date and time.', [ORANGE, 'hourglass'],
    [], ['Delay for', 'Delay until', 'Delay after queue'], 'wait pause sleep later'),
  app('reshape', 'Reshape', 'builtin', 'Tidy up text, numbers and dates between steps.', [ORANGE, 'shapes'],
    [], ['Format text', 'Format number', 'Format date', 'Split text', 'Lookup table'], 'format transform formatter convert text date number'),
  app('code', 'Code step', 'builtin', 'Run a few lines of JavaScript or Python inside a flow.', [ORANGE, 'code'],
    [], ['Run JavaScript', 'Run Python'], 'script function javascript python developer custom'),

  // CRM & sales
  app('pipewell', 'Pipewell', 'crm', 'Pipeline CRM for small sales teams.', ['#2F6BFF', 'pipeline'],
    ['New contact*', 'New deal*', 'Deal stage changed', 'Deal won*'], ['Create contact', 'Create deal', 'Update deal', 'Add note', 'Find contact'], 'crm sales pipeline deals contacts leads'),
  app('leadlark', 'Leadlark', 'crm', 'Capture, score and route inbound leads.', ['#12A594', 'target'],
    ['New lead*', 'Lead score changed'], ['Create lead', 'Assign lead', 'Add tag'], 'leads scoring routing inbound sales'),
  app('dealbeam', 'Dealbeam', 'crm', 'Proposals and deal rooms your buyers can sign in.', ['#7A4DE8', 'docCheck'],
    ['Proposal viewed*', 'Proposal signed*'], ['Create proposal', 'Send proposal'], 'proposals quotes sales documents'),
  app('contactory', 'Contactory', 'crm', 'The shared address book for client teams.', ['#1E3A8A', 'person'],
    ['New contact', 'Updated contact'], ['Create or update contact', 'Find contact'], 'contacts address book people clients'),
  app('cadencio', 'Cadencio', 'crm', 'Email sequences for outbound sales.', ['#E0457B', 'send'],
    ['Reply received*', 'Sequence finished'], ['Add to sequence', 'Remove from sequence'], 'outbound cold email sequences sales'),
  app('quotebird', 'Quotebird', 'crm', 'Quotes and price books for B2B deals.', ['#F5A524', 'quote'],
    ['Quote accepted*'], ['Create quote', 'Update price book'], 'quotes pricing cpq b2b'),
  app('allybase', 'Allybase', 'crm', 'Partner portal for referral and reseller deals.', ['#0B6E4F', 'link'],
    ['New partner deal*'], ['Register deal', 'Invite partner'], 'partners resellers channel referrals'),
  app('keeploop', 'Keeploop', 'crm', 'Renewals and churn signals for account managers.', ['#A93FC4', 'loop'],
    ['Renewal due', 'Health score dropped'], ['Create renewal', 'Log touchpoint'], 'renewals churn customer success accounts'),

  // Forms & surveys
  app('formlane', 'Formlane', 'forms', 'Forms, surveys and quizzes with logic jumps.', ['#7A4DE8', 'clipboard'],
    ['New form entry*', 'New partial entry', 'New payment entry*'], ['Create prefilled link', 'Find entry'], 'forms survey quiz questionnaire signup'),
  app('surveyfox', 'Surveyfox', 'forms', 'Surveys and NPS with branching questions.', ['#E03A3A', 'poll'],
    ['New response*', 'New NPS score*'], ['Send survey', 'Add respondent'], 'surveys nps feedback research'),
  app('fillpoint', 'Fillpoint', 'forms', 'PDF forms people can fill in and sign online.', ['#1C9CC9', 'page'],
    ['New submission*'], ['Create filled PDF'], 'pdf forms applications paperwork'),
  app('votebox', 'Votebox', 'forms', 'Feature voting boards for product teams.', ['#F2C94C', 'bulb'],
    ['New idea*', 'Idea status changed', 'New vote*'], ['Create idea', 'Change status', 'Add vote'], 'feedback feature requests roadmap ideas voting'),
  app('queuely', 'Queuely', 'forms', 'Waitlists and launch sign-ups with referrals.', ['#201515', 'queue'],
    ['New signup*', 'Referral milestone reached'], ['Add to waitlist', 'Invite from waitlist'], 'waitlist launch beta signups'),
  app('ballotbox', 'Ballotbox', 'forms', 'Quick polls for events, classes and teams.', ['#3AA6F0', 'ballot'],
    ['New vote*'], ['Create poll', 'Close poll'], 'polls voting events'),

  // Email
  app('mailcrate', 'Mailcrate', 'email', 'Newsletters and campaigns for growing lists.', ['#F5A524', 'envelope'],
    ['New subscriber*', 'Unsubscribed*', 'Campaign sent'], ['Add or update subscriber', 'Tag subscriber', 'Send campaign'], 'newsletter email marketing campaigns list subscribers'),
  app('postbird', 'Postbird', 'email', 'Transactional email API with templates.', ['#2F6BFF', 'at'],
    ['Email bounced*', 'Email opened*', 'Link clicked*'], ['Send email', 'Send template email'], 'transactional email smtp api receipts'),
  app('inboxly', 'Inboxly', 'email', 'Shared inbox for support@ and sales@ addresses.', ['#12A594', 'inbox'],
    ['New email*', 'New email matching search', 'Conversation assigned'], ['Send email', 'Assign conversation', 'Add label'], 'shared inbox email team'),
  app('brieflet', 'Brieflet', 'email', 'Plain-text newsletters for writers.', ['#201515', 'quill'],
    ['New subscriber*', 'New post'], ['Add subscriber'], 'newsletter writers blog publishing'),
  app('mailglade', 'Mailglade', 'email', 'Personal email with snooze and follow-up reminders.', ['#E0457B', 'envelopeOpen'],
    ['New email', 'New starred email'], ['Send email', 'Create draft', 'Add label'], 'email inbox personal'),
  app('nudgely', 'Nudgely', 'email', 'Lifecycle emails triggered by what users do in your product.', ['#7CB518', 'bell'],
    ['Email sent', 'Journey finished'], ['Track event', 'Start journey'], 'lifecycle onboarding drip product email'),

  // Team chat
  app('chatterbox', 'Chatterbox', 'chat', 'Team chat with channels, threads and huddles.', ['#A93FC4', 'bubble'],
    ['New channel message*', 'New mention*', 'New reaction*'], ['Send channel message', 'Send direct message', 'Create channel', 'Set status'], 'team chat messaging channels notifications'),
  app('parley', 'Parley', 'chat', 'Async updates and check-ins for remote teams.', ['#1C9CC9', 'bubbles'],
    ['New update*'], ['Post update', 'Ask a check-in question'], 'async updates remote team check-ins'),
  app('echoline', 'Echoline', 'chat', 'Chat and shift updates for frontline teams.', ['#E03A3A', 'megaphone'],
    ['New message*'], ['Send message', 'Post announcement'], 'frontline shift chat announcements'),
  app('dailybee', 'Dailybee', 'chat', 'Daily standups that run themselves in chat.', ['#F2C94C', 'sun'],
    ['New standup answer*'], ['Start standup', 'Add participant'], 'standup daily scrum team'),

  // Spreadsheets & databases
  app('gridwell', 'Gridwell', 'sheets', 'Spreadsheets with live formulas and sharing.', ['#1F9D55', 'grid'],
    ['New row', 'Updated row', 'New worksheet'], ['Add row', 'Update row', 'Find row', 'Clear row'], 'spreadsheet sheets rows excel csv'),
  app('rowhouse', 'Rowhouse', 'sheets', 'The spreadsheet-database for operations teams.', ['#2F6BFF', 'house'],
    ['New record*', 'Record enters view', 'Updated record'], ['Create record', 'Update record', 'Find record', 'Delete record'], 'database records table ops no-code'),
  app('querybox', 'Querybox', 'sheets', 'Connect Postgres and MySQL databases to your flows.', ['#334155', 'database'],
    ['New row', 'New row from query'], ['Insert row', 'Update row', 'Run query'], 'sql postgres mysql database'),
  app('sheetmetal', 'Sheetmetal', 'sheets', 'Heavy-duty spreadsheets for finance teams.', ['#6B7A1F', 'sheet'],
    ['New row', 'Cell changed'], ['Add row', 'Update cell'], 'spreadsheet finance models'),
  app('listkeeper', 'Listkeeper', 'sheets', 'Shared lists and simple trackers.', ['#3AA6F0', 'list'],
    ['New item*'], ['Add item', 'Check off item'], 'lists tracker checklist'),

  // Projects & tasks
  app('taskyard', 'Taskyard', 'projects', 'Tasks and projects for teams of 5 to 500.', ['#E0457B', 'check'],
    ['New task*', 'Task completed*', 'Task moved to section'], ['Create task', 'Update task', 'Add comment', 'Create project'], 'tasks projects todo work management'),
  app('kanbanana', 'Kanbanana', 'projects', 'Kanban boards with swimlanes and a sense of humor.', ['#F2C94C', 'columns'],
    ['New card*', 'Card moved to list*'], ['Create card', 'Move card', 'Add checklist item'], 'kanban boards cards'),
  app('milepost', 'Milepost', 'projects', 'Roadmaps and release notes for product teams.', ['#12A594', 'diamond'],
    ['New release', 'Item shipped*'], ['Create roadmap item', 'Publish release note'], 'roadmap releases product changelog'),
  app('bugnest', 'Bugnest', 'projects', 'Issue tracking for software teams.', ['#E03A3A', 'bug'],
    ['New issue*', 'Issue status changed*'], ['Create issue', 'Update issue', 'Add comment'], 'issues bugs tickets sprint'),
  app('punchcard', 'Punchcard', 'projects', 'Time tracking and timesheets for client work.', ['#201515', 'stopwatch'],
    ['New time entry', 'Timer stopped*'], ['Start timer', 'Create time entry'], 'time tracking timesheets billable hours'),
  app('retrobox', 'Retrobox', 'projects', 'Retrospectives and team health checks.', ['#7A4DE8', 'history'],
    ['Retro finished'], ['Create retro', 'Add action item'], 'retrospective agile team'),
  app('goalpost', 'Goalpost', 'projects', 'Goals and OKRs everyone can see.', ['#1F9D55', 'summit'],
    ['Goal updated'], ['Update progress'], 'goals okrs objectives'),

  // Calendar & booking
  app('slotbook', 'Slotbook', 'calendar', 'Booking pages for calls and appointments.', ['#2F6BFF', 'calendar'],
    ['New booking*', 'Booking canceled*', 'Booking rescheduled*'], ['Create booking link', 'Cancel booking'], 'scheduling booking appointments meetings'),
  app('hourglass', 'Hourglass', 'calendar', 'The team calendar with room booking.', ['#1E3A8A', 'calendarDot'],
    ['New event', 'Event starting soon', 'Event canceled'], ['Create event', 'Update event', 'Find event'], 'calendar events rooms'),
  app('ticketmill', 'Ticketmill', 'calendar', 'Tickets and check-ins for events.', ['#E0457B', 'ticket'],
    ['New registration*', 'Attendee checked in*'], ['Create event', 'Add attendee'], 'events tickets registration'),
  app('tablebook', 'Tablebook', 'calendar', 'Restaurant reservations and waitlists.', ['#8B5E3C', 'cup'],
    ['New reservation*'], ['Create reservation'], 'restaurant reservations hospitality'),

  // Payments & accounting
  app('ledgerly', 'Ledgerly', 'payments', 'Invoicing and bookkeeping for small businesses.', ['#0B6E4F', 'receipt'],
    ['New invoice', 'Invoice paid*', 'New expense'], ['Create invoice', 'Send invoice', 'Create customer', 'Record payment'], 'accounting invoices bookkeeping erp finance'),
  app('tillpoint', 'Tillpoint', 'payments', 'Card payments, checkouts and subscriptions.', ['#4C51D9', 'card'],
    ['New payment*', 'New subscription*', 'Subscription canceled*', 'Payment failed*'], ['Create customer', 'Create payment link', 'Refund payment'], 'payments cards checkout subscriptions billing'),
  app('pinepay', 'Pinepay', 'payments', 'Payroll and contractor payments.', ['#1F9D55', 'pine'],
    ['Payroll run completed'], ['Add employee', 'Add contractor'], 'payroll salaries contractors'),
  app('spendkite', 'Spendkite', 'payments', 'Company cards and expense receipts.', ['#3AA6F0', 'kite'],
    ['New expense*', 'Receipt missing'], ['Create expense', 'Lock card'], 'expenses cards receipts spend'),
  app('dueday', 'Dueday', 'payments', 'Bills and approvals for accounts payable.', ['#334155', 'coin'],
    ['New bill', 'Bill approved*'], ['Create bill', 'Schedule payment'], 'bills payables approvals ap'),

  // E-commerce
  app('shopwright', 'Shopwright', 'commerce', 'Online store builder with checkout built in.', ['#1F9D55', 'bag'],
    ['New order*', 'New customer*', 'Order fulfilled*', 'Abandoned cart'], ['Create product', 'Create discount code', 'Fulfill order'], 'store shop ecommerce orders products'),
  app('stockroom', 'Stockroom', 'commerce', 'Inventory across stores and warehouses.', ['#8B5E3C', 'box'],
    ['Low stock*', 'Stock level changed'], ['Adjust stock', 'Create purchase order'], 'inventory stock warehouse'),
  app('boxtruck', 'Boxtruck', 'commerce', 'Shipping labels, tracking and returns.', ['#201515', 'truck'],
    ['Shipment delivered*', 'Shipment exception*'], ['Create shipment', 'Buy label'], 'shipping labels tracking returns'),
  app('starboard', 'Starboard', 'commerce', 'Product reviews and star ratings.', ['#F5A524', 'star'],
    ['New review*'], ['Request review', 'Reply to review'], 'reviews ratings ugc'),
  app('marketstall', 'Marketstall', 'commerce', 'Sell on marketplaces from one catalog.', ['#E03A3A', 'store'],
    ['New marketplace order*'], ['List product', 'Update listing'], 'marketplace listings multichannel'),
  app('boxclub', 'Boxclub', 'commerce', 'Subscription boxes and recurring orders.', ['#A93FC4', 'gift'],
    ['New subscriber*', 'Box shipped'], ['Skip shipment', 'Change plan'], 'subscription box recurring orders'),

  // Marketing
  app('landfall', 'Landfall', 'marketing', 'Landing pages and A/B tests.', ['#7A4DE8', 'layout'],
    ['New signup*', 'Test finished'], ['Publish page'], 'landing pages ab tests conversion'),
  app('adlantic', 'Adlantic', 'marketing', 'One dashboard for all your ad accounts.', ['#2F6BFF', 'waves'],
    ['New lead ad entry*', 'Budget spent'], ['Add to audience', 'Pause campaign'], 'ads advertising campaigns ppc'),
  app('clicktrail', 'Clicktrail', 'marketing', 'Short links with UTM tracking.', ['#12A594', 'cursor'],
    ['New click'], ['Create short link'], 'links utm tracking shortener'),
  app('ripplekit', 'Ripplekit', 'marketing', 'Referral and affiliate programs.', ['#1C9CC9', 'ripple'],
    ['New referral*', 'Reward earned*'], ['Create affiliate', 'Reward referral'], 'referrals affiliates growth'),
  app('beaconly', 'Beaconly', 'marketing', 'On-site popups, banners and exit offers.', ['#E0457B', 'popup'],
    ['New popup signup*'], ['Show campaign'], 'popups banners conversion'),

  // Support
  app('deskpilot', 'Deskpilot', 'support', 'Help desk with SLAs, macros and CSAT.', ['#1C9CC9', 'lifebuoy'],
    ['New ticket*', 'Ticket updated*', 'Ticket solved*'], ['Create ticket', 'Update ticket', 'Add internal note'], 'helpdesk support tickets customer service'),
  app('caseload', 'Caseload', 'support', 'Customer support inbox for small teams.', ['#201515', 'headset'],
    ['New conversation*'], ['Reply to conversation', 'Close conversation'], 'support inbox customers'),
  app('helpnest', 'Helpnest', 'support', 'Knowledge base and public help docs.', ['#F5A524', 'book'],
    ['New article', 'Article feedback*'], ['Create article', 'Update article'], 'knowledge base docs help center faq'),
  app('statuslight', 'Statuslight', 'support', 'Status pages and incident updates.', ['#1F9D55', 'status'],
    ['New incident*', 'Incident resolved*'], ['Create incident', 'Post incident update'], 'status page incidents uptime'),
  app('replybay', 'Replybay', 'support', 'Social and review replies in one inbox.', ['#4C51D9', 'reply'],
    ['New mention*'], ['Reply to mention'], 'social support reviews replies'),

  // Developer tools
  app('codeharbor', 'Codeharbor', 'dev', 'Code hosting, reviews and pull requests.', ['#201515', 'anchor'],
    ['New pull request*', 'New issue*', 'New release*', 'New push*'], ['Create issue', 'Comment on pull request'], 'git code repository pull requests developers'),
  app('errorbeam', 'Errorbeam', 'dev', 'Error tracking with alerts that make sense.', ['#E03A3A', 'alert'],
    ['New error*', 'Error spike*'], ['Resolve error', 'Assign error'], 'errors exceptions monitoring bugs'),
  app('uptide', 'Uptide', 'dev', 'Uptime and cron job monitoring.', ['#12A594', 'pulse'],
    ['Monitor down*', 'Monitor back up*'], ['Pause monitor'], 'uptime monitoring cron alerts'),
  app('flagpole', 'Flagpole', 'dev', 'Feature flags and gradual rollouts.', ['#7A4DE8', 'flag'],
    ['Flag changed*'], ['Turn flag on or off'], 'feature flags rollouts experiments'),
  app('launchlog', 'Launchlog', 'dev', 'Deploy tracking and changelogs.', ['#2F6BFF', 'arrowUp'],
    ['Deploy finished*', 'Deploy failed*'], ['Create changelog entry'], 'deploys releases changelog ci'),
  app('envkeeper', 'Envkeeper', 'dev', 'Secrets and environment variables for every stage.', ['#334155', 'key'],
    ['Secret rotated*'], ['Rotate secret'], 'secrets env variables security'),

  // Files & docs
  app('filebarn', 'Filebarn', 'files', 'Cloud storage for teams and clients.', ['#3AA6F0', 'folder'],
    ['New file in folder*', 'New folder'], ['Upload file', 'Create folder', 'Create share link'], 'files storage cloud drive folders'),
  app('paperstack', 'Paperstack', 'files', 'Docs and wikis your team actually reads.', ['#201515', 'doc'],
    ['New page', 'Page updated'], ['Create page', 'Append to page'], 'docs wiki notes documentation'),
  app('inksign', 'Inksign', 'files', 'E-signatures and contract templates.', ['#1E3A8A', 'pen'],
    ['Document signed*', 'Document declined*'], ['Send for signature'], 'esignature contracts signing'),
  app('docufold', 'Docufold', 'files', 'PDF tools: merge, split, fill and convert.', ['#E03A3A', 'layers'],
    [], ['Merge PDFs', 'Split PDF', 'Convert to PDF'], 'pdf convert merge documents'),
  app('assetbay', 'Assetbay', 'files', 'Brand assets and a shared image library.', ['#E0457B', 'image'],
    ['New asset'], ['Upload asset'], 'assets images brand dam'),

  // HR & recruiting
  app('crewbase', 'Crewbase', 'hr', 'HR, onboarding and time off in one place.', ['#12A594', 'people'],
    ['New hire*', 'Time off approved*', 'Employee left'], ['Create employee', 'Update employee'], 'hr hris onboarding employees'),
  app('hireloop', 'Hireloop', 'hr', 'Applicant tracking for growing teams.', ['#7A4DE8', 'personPlus'],
    ['New applicant*', 'Candidate stage changed*'], ['Create candidate', 'Move candidate'], 'recruiting ats hiring candidates jobs'),
  app('propsly', 'Propsly', 'hr', 'Peer shout-outs and recognition.', ['#F5A524', 'heart'],
    ['New shout-out*'], ['Give props'], 'recognition kudos culture'),
  app('rotaplan', 'Rotaplan', 'hr', 'Shift scheduling for hourly teams.', ['#1C9CC9', 'rota'],
    ['Shift published', 'Shift swapped*'], ['Create shift'], 'shifts scheduling rota hourly'),

  // AI
  app('draftkite', 'Draftkite', 'ai', 'AI writing that sounds like your team.', ['#201515', 'spark'],
    [], ['Draft a reply', 'Summarize text', 'Rewrite in brand voice'], 'ai writing gpt llm summarize draft'),
  app('minutely', 'Minutely', 'ai', 'AI meeting notes and action items.', ['#4C51D9', 'wave'],
    ['New meeting notes*', 'New action item*'], ['Share notes'], 'ai meeting notes transcripts summaries'),
  app('tagwright', 'Tagwright', 'ai', 'AI that labels, sorts and routes text.', ['#1F9D55', 'tag'],
    [], ['Classify text', 'Extract fields', 'Detect language'], 'ai classify extract nlp routing'),
  app('voxbin', 'Voxbin', 'ai', 'Transcripts of calls, voice notes and videos.', ['#E03A3A', 'mic'],
    ['New transcript*'], ['Transcribe audio'], 'transcription audio voice ai'),
  app('askbase', 'Askbase', 'ai', 'Answers from your own docs, in any app.', ['#2F6BFF', 'searchDoc'],
    [], ['Ask your docs', 'Add a source'], 'ai knowledge answers rag docs'),
  app('promptpad', 'Promptpad', 'ai', 'A shared prompt library for your team.', ['#A93FC4', 'prompt'],
    [], ['Run prompt'], 'ai prompts library'),

  // Analytics
  app('datapond', 'Datapond', 'analytics', 'Product analytics, funnels and cohorts.', ['#1C9CC9', 'bars'],
    ['New signup event*', 'Cohort updated'], ['Track event', 'Identify user'], 'analytics product events funnels'),
  app('pulseboard', 'Pulseboard', 'analytics', 'Dashboards for the numbers that matter.', ['#7A4DE8', 'gauge'],
    ['Metric crossed a threshold*'], ['Add data point'], 'dashboards kpis metrics'),
  app('scrollwise', 'Scrollwise', 'analytics', 'Heatmaps and session replays.', ['#F5A524', 'eye'],
    ['New rage click*'], ['Tag session'], 'heatmaps session replay ux'),
  app('rankwell', 'Rankwell', 'analytics', 'SEO rank tracking and site audits.', ['#0B6E4F', 'trend'],
    ['Rank changed', 'Audit finished'], ['Add keyword'], 'seo rankings search audits'),

  // Phone & SMS
  app('textbeam', 'Textbeam', 'phone', 'Business texting and SMS reminders.', ['#1F9D55', 'sms'],
    ['New inbound SMS*'], ['Send SMS', 'Send MMS'], 'sms text messages reminders'),
  app('ringwise', 'Ringwise', 'phone', 'A cloud phone system for small teams.', ['#2F6BFF', 'phone'],
    ['New call*', 'Missed call*', 'New voicemail*'], ['Log a call', 'Send SMS'], 'phone calls voip voicemail'),
  app('nightbell', 'Nightbell', 'phone', 'On-call schedules and paging.', ['#1E3A8A', 'moon'],
    ['New alert*', 'Alert acknowledged*'], ['Page on-call', 'Create alert'], 'on-call paging incidents alerts'),

  // Social & community
  app('chirplane', 'Chirplane', 'social', 'Schedule posts across social networks.', ['#3AA6F0', 'share'],
    ['Post published*', 'New mention*'], ['Schedule post', 'Add to queue'], 'social media posts scheduling'),
  app('reelhouse', 'Reelhouse', 'social', 'Short videos, clips and captions.', ['#E0457B', 'play'],
    ['New video*'], ['Publish video'], 'video clips social'),
  app('guildhall', 'Guildhall', 'social', 'Paid communities and member forums.', ['#6B7A1F', 'hash'],
    ['New member*', 'New post*'], ['Add member', 'Create post'], 'community forum members'),
  app('biobox', 'Biobox', 'social', 'Link-in-bio pages with click stats.', ['#201515', 'bio'],
    ['New click'], ['Add link'], 'link in bio creators'),

  // Video & events
  app('callhaus', 'Callhaus', 'video', 'Video meetings with recordings and notes.', ['#12A594', 'video'],
    ['Meeting ended*', 'New recording*'], ['Create meeting'], 'video meetings calls conferencing'),
  app('clipnote', 'Clipnote', 'video', 'Screen recordings with comments.', ['#7A4DE8', 'record'],
    ['New recording*', 'New comment*'], ['Share recording'], 'screen recording async video'),
  app('stagelight', 'Stagelight', 'video', 'Webinars and live events.', ['#201515', 'spot'],
    ['New registrant*', 'Attendee joined*'], ['Register attendee'], 'webinars live events'),
  app('wavecast', 'Wavecast', 'video', 'Podcast hosting and episode stats.', ['#A93FC4', 'podcast'],
    ['New episode*'], ['Publish episode'], 'podcast audio episodes'),
  app('classbloom', 'Classbloom', 'video', 'Online courses and cohorts.', ['#1F9D55', 'cap'],
    ['New student*', 'Lesson completed*'], ['Enroll student'], 'courses education lms learning'),
];

export const APP_BY_ID = new Map(APPS.map((a) => [a.id, a]));
export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

// The directory's front page, in this order.
export const POPULAR = ['pipewell', 'formlane', 'chatterbox', 'gridwell', 'taskyard', 'ledgerly', 'tillpoint', 'shopwright', 'deskpilot', 'slotbook', 'mailcrate', 'webhooks'];

// Flow templates. `name` is what replies write inside [[Flow: …]]; `title` is
// the gallery's sentence. An action with `to: null` takes its app from the
// conversation (see flows.js), falling back to `fallback`.
export const FLOWS = [
  { id: 'form-to-crm', name: 'New form entry → Create CRM contact', title: 'Add new Formlane entries to Pipewell as contacts',
    trigger: ['formlane', 'New form entry'], action: ['pipewell', 'Create contact'] },
  { id: 'deal-to-chat', name: 'Deal won → Post in team chat', title: 'Celebrate won deals in a Chatterbox channel',
    trigger: ['pipewell', 'Deal won'], action: ['chatterbox', 'Send channel message'] },
  { id: 'invoice-to-sheet', name: 'Invoice paid → Add spreadsheet row', title: 'Log every paid Ledgerly invoice in Gridwell',
    trigger: ['ledgerly', 'Invoice paid'], action: ['gridwell', 'Add row'] },
  { id: 'ticket-to-task', name: 'New ticket → Create task', title: 'Turn Deskpilot tickets into Taskyard tasks',
    trigger: ['deskpilot', 'New ticket'], action: ['taskyard', 'Create task'] },
  { id: 'booking-to-sms', name: 'New booking → Send SMS reminder', title: 'Text a reminder for every Slotbook booking',
    trigger: ['slotbook', 'New booking'], action: ['textbeam', 'Send SMS'] },
  { id: 'order-to-stock', name: 'New order → Update inventory', title: 'Keep Stockroom in sync with Shopwright orders',
    trigger: ['shopwright', 'New order'], action: ['stockroom', 'Adjust stock'] },
  { id: 'webhook-to-record', name: 'Caught webhook → Create record', title: 'Send any app’s webhooks into Rowhouse',
    trigger: ['webhooks', 'Catch hook'], action: [null, 'Create'], fallback: 'rowhouse' },
  { id: 'morning-api', name: 'Every morning → Call an API', title: 'Call an API every weekday at 8:00',
    trigger: ['timer', 'Every day'], action: ['http', 'Make a request'] },
  { id: 'error-to-chat', name: 'New error → Alert in team chat', title: 'Post new Errorbeam errors to a Chatterbox channel',
    trigger: ['errorbeam', 'New error'], action: ['chatterbox', 'Send channel message'] },
  { id: 'notes-to-docs', name: 'Meeting notes → Save to docs', title: 'Save Minutely meeting notes as Paperstack pages',
    trigger: ['minutely', 'New meeting notes'], action: ['paperstack', 'Create page'] },
  { id: 'email-to-ticket', name: 'New email → Create ticket', title: 'Open a Deskpilot ticket for every Inboxly email',
    trigger: ['inboxly', 'New email'], action: ['deskpilot', 'Create ticket'] },
  { id: 'signed-to-files', name: 'Document signed → Save to files', title: 'File every signed Inksign contract in Filebarn',
    trigger: ['inksign', 'Document signed'], action: ['filebarn', 'Upload file'] },
];

export const FLOW_BY_ID = new Map(FLOWS.map((f) => [f.id, f]));

// The gallery on the page, in this order.
export const GALLERY = ['form-to-crm', 'booking-to-sms', 'deal-to-chat', 'invoice-to-sheet', 'ticket-to-task', 'webhook-to-record'];
