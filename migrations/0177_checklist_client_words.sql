-- A checklist item's words on the client's record, under "What was done", which are not the technician's: "Refitted"
-- where the technician ticks "Hair system refitted". Null for an item only the technician needs, such as checking a
-- new hair system against its label. An item already saved keeps showing the client what it showed before.
ALTER TABLE checklist_items ADD COLUMN client_label TEXT;

UPDATE checklist_items SET client_label = label;
