// Zoho FSM answers, shaped as the real org answered during the trial
// (docs/decisions/fsm-trial.md), with made-up values. Each carries more fields
// than the provider reads, as FSM's do.

export const FSM_API = "https://www.zohoapis.in/fsm/v1";
export const ZOHO_TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token";

export const person = (name: string, id: string) => ({ name, id, email: "someone@example.com" });

/** An appointment for one service line, one technician, scheduled for a morning. */
export function fsmAppointmentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "ap-1",
    Name: "AP-1",
    Status: "Scheduled",
    Work_Order: { name: "WO1", id: "wo-1" },
    Contact: { name: "Rohit Malhotra", id: "contact-1" },
    Scheduled_Start_Date_Time: "2026-09-24T10:00:00+05:30",
    Scheduled_End_Date_Time: "2026-09-24T11:30:00+05:30",
    Actual_Start_Date_Time: null,
    Actual_End_Date_Time: null,
    Service_Resources: [],
    $Service_Resources: [{ Type: "Agent", parent_id: "user-1", name: "Imran Khan", id: "sr-1" }],
    Appointments_X_Services: [
      {
        Owner: person("Ops", "user-9"),
        Name: "WOxAP-1",
        Work_Order: { name: "WO1", id: "wo-1" },
        Service_Line_Item: { name: "SVC-1", Service: "item-service-visit", id: "line-1" },
        SLI_Status: "Scheduled",
        id: "axs-1",
      },
    ],
    Invoice_Id: null,
    Billing_Status: "Not yet Invoiced",
    Territory: { name: "Mane Man", id: "territory-1" },
    Service_Address: { Service_City: "Gurgaon", Service_Zip_Code: "122018", id: "address-1" },
    Owner: person("Ops", "user-9"),
    Modified_Time: "2026-09-22T14:27:15+05:30",
    ...overrides,
  };
}

/** A closed work order for one service line, as FSM answers it before it is billed. */
export function fsmWorkOrderRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    Name: "WO1",
    Status: "Closed",
    Billing_Status: "Not yet Invoiced",
    Sub_Total: 2000,
    Grand_Total: 2000,
    Contact: { name: "Rohit Malhotra", id: "contact-1" },
    Territory: { name: "Mane Man", id: "territory-1" },
    Service_Line_Items: [
      {
        id: "line-1",
        Name: "SVC-1",
        Service: { name: "Service visit", id: "item-service-visit" },
        Quantity: 1,
        Amount: 2000,
        Status: "Completed",
        Billing_Status: "Not yet Invoiced",
        Invoice_Id: null,
      },
    ],
    Owner: person("Ops", "user-9"),
    Modified_Time: "2026-09-23T13:31:48+05:30",
    ...overrides,
  };
}

/** An invoice as FSM holds it: FSM's own record, and Books' ID for the document itself. */
export function fsmInvoiceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "fsm-invoice-1",
    Name: "INV-000001",
    Status: "draft",
    Grouped_Invoice: "1",
    Work_Order: { name: "WO1", id: "wo-1" },
    Contact_Id: { name: "Rohit Malhotra", id: "contact-1" },
    ZBilling_InvoiceId: "books-invoice-1",
    Date: "2026-09-23",
    Due_Date: "2026-09-23",
    Currency: "INR",
    total: 2000,
    balance: 2000,
    ...overrides,
  };
}

export function fsmContactRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    Salutation: null,
    First_Name: "Rohit",
    Last_Name: "Malhotra",
    Full_Name: "Rohit Malhotra",
    Mobile: "+919810000001",
    Phone: null,
    Email: "rohit@example.com",
    ZBooks_Contact_Person: null,
    Owner: person("Ops", "user-9"),
    Modified_Time: "2026-09-22T14:27:12+05:30",
    ...overrides,
  };
}

export function fsmUserRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    full_name: "Imran Khan",
    first_name: "Imran",
    last_name: "Khan",
    email: "imran@example.com",
    mobile: "+919810000009",
    status: "active",
    profile: { name: "Field Technician", id: "profile-2" },
    Territory: { name: "Gurgaon", id: "territory-1" },
    Service_Resources: { User: "user-1", id: "sr-1", SE_PRESENCE: 1, isActive: true, Name: "Imran Khan" },
    ...overrides,
  };
}

export function fsmAttachmentRecord(overrides: Record<string, unknown> = {}) {
  return {
    Owner: person("Ops", "user-9"),
    File_Name: "before-front.jpg",
    Created_Time: "2026-09-22T14:27:16+05:30",
    Size: "22738",
    $file_id: "file-abc",
    $se_module: "Service_Appointments",
    id: "attachment-1",
    Parent_Record_Id: { name: "AP-1", id: "ap-1" },
    ...overrides,
  };
}
