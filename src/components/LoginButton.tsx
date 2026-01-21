import { signIn } from "../lib/auth-client";

interface LoginButtonProps {
    callbackURL: string;
}

export function LoginButton({ callbackURL }: LoginButtonProps) {
    const handleLogin = async () => {
        const result = await signIn.social({
            provider: "discord",
            callbackURL,
        });
        
        if (result.data?.url) {
            window.location.href = result.data.url;
        }
    };

    return (
        <button onClick={handleLogin} className="discord-btn">
            Sign in with Discord
        </button>
    );
}
