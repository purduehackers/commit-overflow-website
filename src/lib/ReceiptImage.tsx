export function ReceiptImage({ receiptText, scale }: { receiptText: string; scale: number }) {
    const lines = receiptText.split("\n");

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 48 * scale,
                backgroundColor: "#0d0d0d",
                width: "100%",
                height: "100%",
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    fontFamily: "Fira Code",
                    fontSize: 14 * scale,
                    lineHeight: 1.4,
                    color: "#e0e0e0",
                    backgroundColor: "#0d0d0d",
                    padding: 32 * scale,
                    borderRadius: 8 * scale,
                    border: `${scale}px solid #333`,
                }}
            >
                {lines.map((line, i) => (
                    <div
                        key={i}
                        style={{
                            display: "flex",
                            whiteSpace: "pre",
                        }}
                    >
                        {line || " "}
                    </div>
                ))}
            </div>
        </div>
    );
}
