// Technician pay's calls to mm-api: the grades and their rates, a technician's grade, and their statements. Each is the
// console's client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import { client, type PayRateSet } from "../api.ts";

export const technicianPayApi = {
  technicianPay: () => client.get("/api/technician-pay"),
  payStatement: (month: string) => client.get("/api/technician-pay/statement", { query: { month } }),
  addPayGrade: (name: string) => client.post("/api/technician-pay/grades", { body: { name } }),
  renamePayGrade: (id: string, name: string) =>
    client.patch("/api/technician-pay/grades/{id}", { path: { id }, body: { name } }),
  /** Refused, as in_use, while a technician holds it or a rate has named it. */
  deletePayGrade: (id: string) => client.post("/api/technician-pay/grades/{id}/delete", { path: { id } }),
  /** From today or later; an amount of null leaves the grade no rate of its own from that day. */
  setPayRate: (rate: PayRateSet) => client.post("/api/technician-pay/rates", { body: rate }),
  setPayGradeOf: (technicianId: string, gradeId: string | null) =>
    client.post("/api/technician-pay/technicians/{id}", { path: { id: technicianId }, body: { grade_id: gradeId } }),
};
