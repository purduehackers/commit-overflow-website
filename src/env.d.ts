/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

type User = {
    id: string;
    email: string;
    name: string;
    image?: string | null;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
};

type Session = {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt: Date;
    updatedAt: Date;
};

declare global {
    namespace App {
        interface Locals {
            user: User | null;
            session: Session | null;
        }
    }
}

export {};
