import { createAdapterFactory, type Where } from "better-auth/adapters";
import { queryD1 } from "./d1";

function buildWhereClause(where: Where[]): { sql: string; params: unknown[] } {
    if (!where || where.length === 0) {
        return { sql: "", params: [] };
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    for (let i = 0; i < where.length; i++) {
        const clause = where[i];
        const { field, value, operator = "eq" } = clause;

        let condition: string;

        switch (operator) {
            case "eq":
                if (value === null) {
                    condition = `${field} IS NULL`;
                } else {
                    condition = `${field} = ?`;
                    params.push(value);
                }
                break;
            case "ne":
                if (value === null) {
                    condition = `${field} IS NOT NULL`;
                } else {
                    condition = `${field} != ?`;
                    params.push(value);
                }
                break;
            case "lt":
                condition = `${field} < ?`;
                params.push(value);
                break;
            case "lte":
                condition = `${field} <= ?`;
                params.push(value);
                break;
            case "gt":
                condition = `${field} > ?`;
                params.push(value);
                break;
            case "gte":
                condition = `${field} >= ?`;
                params.push(value);
                break;
            case "in":
                if (Array.isArray(value) && value.length > 0) {
                    const placeholders = value.map(() => "?").join(", ");
                    condition = `${field} IN (${placeholders})`;
                    params.push(...value);
                } else {
                    condition = "1 = 0";
                }
                break;
            case "not_in":
                if (Array.isArray(value) && value.length > 0) {
                    const placeholders = value.map(() => "?").join(", ");
                    condition = `${field} NOT IN (${placeholders})`;
                    params.push(...value);
                } else {
                    condition = "1 = 1";
                }
                break;
            case "contains":
                condition = `${field} LIKE ?`;
                params.push(`%${value}%`);
                break;
            case "starts_with":
                condition = `${field} LIKE ?`;
                params.push(`${value}%`);
                break;
            case "ends_with":
                condition = `${field} LIKE ?`;
                params.push(`%${value}`);
                break;
            default:
                condition = `${field} = ?`;
                params.push(value);
        }

        if (i > 0) {
            const connector = clause.connector || "AND";
            conditions.push(`${connector} ${condition}`);
        } else {
            conditions.push(condition);
        }
    }

    return {
        sql: `WHERE ${conditions.join(" ")}`,
        params,
    };
}

function generateId(): string {
    return crypto.randomUUID();
}

export const d1Adapter = () =>
    createAdapterFactory({
        config: {
            adapterId: "d1-http",
            adapterName: "Cloudflare D1 HTTP Adapter",
            usePlural: false,
            debugLogs: false,
        },
        adapter: ({ getModelName, getFieldName }) => {
            return {
                create: async ({ model, data }) => {
                    const tableName = getModelName(model);
                    const id = (data as Record<string, unknown>).id || generateId();
                    const dataWithId = { ...data, id } as Record<string, unknown>;

                    const columns = Object.keys(dataWithId);
                    const values = Object.values(dataWithId);
                    const placeholders = columns.map(() => "?").join(", ");

                    const sql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;
                    await queryD1(sql, values);

                    const [result] = await queryD1<typeof data>(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);

                    return result;
                },

                findOne: async <T>({ model, where }: { model: string; where: Where[] }) => {
                    const tableName = getModelName(model);
                    const mappedWhere = (where || []).map((w) => ({
                        ...w,
                        field: getFieldName({ model, field: w.field }),
                    }));
                    const { sql: whereClause, params } = buildWhereClause(mappedWhere);

                    const sql = `SELECT * FROM ${tableName} ${whereClause} LIMIT 1`;
                    const [result] = await queryD1<T>(sql, params);

                    return result || null;
                },

                findMany: async <T>({ model, where, limit, offset, sortBy }: { model: string; where?: Where[]; limit?: number; offset?: number; sortBy?: { field: string; direction: "asc" | "desc" } }) => {
                    const tableName = getModelName(model);
                    const mappedWhere = (where || []).map((w) => ({
                        ...w,
                        field: getFieldName({ model, field: w.field }),
                    }));
                    const { sql: whereClause, params } = buildWhereClause(mappedWhere);

                    let sql = `SELECT * FROM ${tableName} ${whereClause}`;

                    if (sortBy) {
                        const sortField = getFieldName({ model, field: sortBy.field });
                        const direction = sortBy.direction === "desc" ? "DESC" : "ASC";
                        sql += ` ORDER BY ${sortField} ${direction}`;
                    }

                    if (limit !== undefined) {
                        sql += ` LIMIT ?`;
                        params.push(limit);
                    }

                    if (offset !== undefined) {
                        sql += ` OFFSET ?`;
                        params.push(offset);
                    }

                    return queryD1<T>(sql, params);
                },

                update: async <T>({ model, where, update }: { model: string; where: Where[]; update: T }) => {
                    const tableName = getModelName(model);
                    const mappedWhere = (where || []).map((w) => ({
                        ...w,
                        field: getFieldName({ model, field: w.field }),
                    }));
                    const { sql: whereClause, params: whereParams } = buildWhereClause(mappedWhere);

                    const updateData = update as Record<string, unknown>;
                    const updateFields = Object.keys(updateData).map((k) => getFieldName({ model, field: k }));
                    const updateValues = Object.values(updateData);
                    const setClause = updateFields.map((field) => `${field} = ?`).join(", ");

                    const sql = `UPDATE ${tableName} SET ${setClause} ${whereClause}`;
                    await queryD1(sql, [...updateValues, ...whereParams]);

                    const selectSql = `SELECT * FROM ${tableName} ${whereClause} LIMIT 1`;
                    const [result] = await queryD1<T>(selectSql, whereParams);

                    return result || null;
                },

                updateMany: async ({ model, where, update }) => {
                    const tableName = getModelName(model);
                    const mappedWhere = (where || []).map((w) => ({
                        ...w,
                        field: getFieldName({ model, field: w.field }),
                    }));
                    const { sql: whereClause, params: whereParams } = buildWhereClause(mappedWhere);

                    const updateData = update as Record<string, unknown>;
                    const updateFields = Object.keys(updateData).map((k) => getFieldName({ model, field: k }));
                    const updateValues = Object.values(updateData);
                    const setClause = updateFields.map((field) => `${field} = ?`).join(", ");

                    const sql = `UPDATE ${tableName} SET ${setClause} ${whereClause}`;
                    await queryD1(sql, [...updateValues, ...whereParams]);

                    return 0;
                },

                delete: async ({ model, where }) => {
                    const tableName = getModelName(model);
                    const mappedWhere = (where || []).map((w) => ({
                        ...w,
                        field: getFieldName({ model, field: w.field }),
                    }));
                    const { sql: whereClause, params } = buildWhereClause(mappedWhere);
                    const sql = `DELETE FROM ${tableName} ${whereClause}`;
                    await queryD1(sql, params);
                },

                deleteMany: async ({ model, where }) => {
                    const tableName = getModelName(model);
                    const mappedWhere = (where || []).map((w) => ({
                        ...w,
                        field: getFieldName({ model, field: w.field }),
                    }));
                    const { sql: whereClause, params } = buildWhereClause(mappedWhere);
                    const sql = `DELETE FROM ${tableName} ${whereClause}`;
                    await queryD1(sql, params);
                    return 0;
                },

                count: async ({ model, where }) => {
                    const tableName = getModelName(model);
                    const mappedWhere = (where || []).map((w) => ({
                        ...w,
                        field: getFieldName({ model, field: w.field }),
                    }));
                    const { sql: whereClause, params } = buildWhereClause(mappedWhere);
                    const sql = `SELECT COUNT(*) as count FROM ${tableName} ${whereClause}`;
                    const [result] = await queryD1<{ count: number }>(sql, params);
                    return result?.count || 0;
                },
            };
        },
    });
