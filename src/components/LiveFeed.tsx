import { useState, useEffect, useCallback, useRef } from "react";

import useSWRInfinite from "swr/infinite";
import { fetcher } from "../lib/fetcher";

interface Attachment {
    url: string;
    type: string;
}

interface RecentCommit {
    odId: string;
    username: string;
    avatarUrl: string;
    relativeTime: string;
    threadId: string;
    messageId: string;
    messageHtml: string;
    attachments: { url: string; type: string; filename: string }[];
}

interface PaginatedCommitsResponse {
    commits: RecentCommit[];
    pagination: {
        page: number;
        limit: number;
        hasMore: boolean;
        total: number;
    };
}

function isVideo(type: string): boolean {
    return type.startsWith("video/");
}

function isImage(type: string): boolean {
    return type.startsWith("image/");
}

function isAudio(type: string): boolean {
    return type.startsWith("audio/");
}

interface LightboxState {
    isOpen: boolean;
    attachments: Attachment[];
    currentIndex: number;
}

interface LightboxProps {
    attachments: Attachment[];
    currentIndex: number;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
}

function Lightbox({ attachments, currentIndex, onClose, onPrev, onNext }: LightboxProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowLeft") onPrev();
            if (e.key === "ArrowRight") onNext();

            // Focus trap: cycle through focusable elements
            if (e.key === "Tab" && dialogRef.current) {
                const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
                );
                const firstElement = focusableElements[0];
                const lastElement = focusableElements[focusableElements.length - 1];

                if (e.shiftKey && document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement?.focus();
                } else if (!e.shiftKey && document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement?.focus();
                }
            }
        },
        [onClose, onPrev, onNext],
    );

    useEffect(() => {
        // Focus the close button when lightbox opens
        closeButtonRef.current?.focus();

        document.addEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "";
        };
    }, [handleKeyDown]);

    const current = attachments[currentIndex];
    const hasMultiple = attachments.length > 1;

    return (
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Image viewer, showing image ${currentIndex + 1} of ${attachments.length}`}
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(0, 0, 0, 0.9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                cursor: "pointer",
            }}
        >
            <button
                ref={closeButtonRef}
                onClick={onClose}
                style={{
                    position: "absolute",
                    top: "1rem",
                    right: "1rem",
                    background: "none",
                    border: "none",
                    color: "white",
                    fontSize: "2rem",
                    cursor: "pointer",
                    padding: "0.5rem",
                    lineHeight: 1,
                    zIndex: 10000,
                }}
                aria-label="Close lightbox"
            >
                ×
            </button>

            {hasMultiple && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onPrev();
                    }}
                    style={{
                        position: "absolute",
                        left: "1rem",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "rgba(255, 255, 255, 0.1)",
                        border: "none",
                        color: "white",
                        fontSize: "2rem",
                        cursor: "pointer",
                        padding: "0.5rem 1rem",
                        borderRadius: "4px",
                        zIndex: 10000,
                    }}
                    aria-label="Previous image"
                >
                    ←
                </button>
            )}

            <img
                src={current.url}
                alt={`Attachment image ${currentIndex + 1} of ${attachments.length}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                    maxWidth: "90vw",
                    maxHeight: "90vh",
                    objectFit: "contain",
                    cursor: "default",
                    borderRadius: "4px",
                }}
            />

            {hasMultiple && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onNext();
                    }}
                    style={{
                        position: "absolute",
                        right: "1rem",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "rgba(255, 255, 255, 0.1)",
                        border: "none",
                        color: "white",
                        fontSize: "2rem",
                        cursor: "pointer",
                        padding: "0.5rem 1rem",
                        borderRadius: "4px",
                        zIndex: 10000,
                    }}
                    aria-label="Next image"
                >
                    →
                </button>
            )}

            {hasMultiple && (
                <div
                    aria-live="polite"
                    style={{
                        position: "absolute",
                        bottom: "1rem",
                        left: "50%",
                        transform: "translateX(-50%)",
                        color: "white",
                        fontSize: "0.875rem",
                        zIndex: 10000,
                    }}
                >
                    {currentIndex + 1} / {attachments.length}
                </div>
            )}
        </div>
    );
}

export function LiveFeed() {
    const getKey = (pageIndex: number, previousPageData: PaginatedCommitsResponse | null) => {
        if (previousPageData && !previousPageData.pagination.hasMore) return null;
        return `/api/commits?page=${pageIndex + 1}&limit=10`;
    };

    const { data, error, size, setSize, isValidating, mutate } =
        useSWRInfinite<PaginatedCommitsResponse>(getKey, fetcher, {
            refreshInterval: 10000,
            revalidateFirstPage: true,
        });

    const sentinelRef = useRef<HTMLDivElement>(null);

    const [lightbox, setLightbox] = useState<LightboxState>({
        isOpen: false,
        attachments: [],
        currentIndex: 0,
    });

    const triggerElementRef = useRef<HTMLElement | null>(null);

    const allCommits = data ? data.flatMap((page) => page.commits) : [];
    const isLoadingInitial = !data && !error;
    const isLoadingMore = isValidating && data && data.length === size;
    const hasMore = data ? data[data.length - 1]?.pagination.hasMore : false;

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !isValidating) {
                    setSize((s) => s + 1);
                }
            },
            { rootMargin: "100px" },
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, isValidating, setSize]);

    const openLightbox = (
        attachments: Attachment[],
        clickedIndex: number,
        triggerElement: HTMLElement,
    ) => {
        triggerElementRef.current = triggerElement;
        const imageAttachments = attachments.filter((a) => isImage(a.type));
        setLightbox({
            isOpen: true,
            attachments: imageAttachments,
            currentIndex: clickedIndex,
        });
    };

    const closeLightbox = () => {
        setLightbox((prev) => ({ ...prev, isOpen: false }));
        triggerElementRef.current?.focus();
        triggerElementRef.current = null;
    };

    const goToPrev = () => {
        setLightbox((prev) => ({
            ...prev,
            currentIndex:
                prev.currentIndex === 0 ? prev.attachments.length - 1 : prev.currentIndex - 1,
        }));
    };

    const goToNext = () => {
        setLightbox((prev) => ({
            ...prev,
            currentIndex:
                prev.currentIndex === prev.attachments.length - 1 ? 0 : prev.currentIndex + 1,
        }));
    };

    if (error) {
        return (
            <section className="feed-section" aria-labelledby="feed-heading-error">
                <div className="feed-header" style={{ marginBottom: "1.25rem" }}>
                    <h2 id="feed-heading-error" style={{ font: "inherit", margin: 0 }}>
                        RECENT ACTIVITY
                    </h2>
                </div>
                <pre style={{ color: "var(--error, #ff6b6b)" }} role="alert">
                    ╳ Failed to load activity feed.{" "}
                    <button
                        onClick={() => mutate()}
                        aria-label="Retry loading activity feed"
                        style={{
                            background: "none",
                            border: "none",
                            color: "inherit",
                            fontFamily: "inherit",
                            fontSize: "inherit",
                            cursor: "pointer",
                            textDecoration: "underline",
                        }}
                    >
                        [retry]
                    </button>
                </pre>
            </section>
        );
    }

    if (isLoadingInitial) {
        const skeletonItems = Array(5)
            .fill(0)
            .map((_, i) => (
                <div key={i} className="feed-item skeleton">
                    <div
                        className="feed-item-row"
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            width: "100%",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5ch" }}>
                            <span className="avatar-placeholder"></span>
                            <span>░░░░░░░░░░ committed</span>
                        </div>
                        <span className="muted">░░ ago</span>
                    </div>
                    <div className="feed-item-message muted" style={{ paddingLeft: "32px" }}>
                        └→ ░░░░░░░░░░░░░░░░░░░░
                    </div>
                </div>
            ));

        return (
            <section
                className="feed-section"
                aria-labelledby="feed-heading-loading"
                aria-busy="true"
            >
                <div className="feed-header" style={{ marginBottom: "1.25rem" }}>
                    <h2 id="feed-heading-loading" style={{ font: "inherit", margin: 0 }}>
                        RECENT ACTIVITY
                    </h2>
                </div>
                <div className="feed-list">{skeletonItems}</div>
            </section>
        );
    }

    const recentCommits = allCommits;

    return (
        <section className="feed-section" aria-labelledby="feed-heading">
            <div className="feed-header" style={{ marginBottom: "1.25rem" }}>
                <h2 id="feed-heading" style={{ font: "inherit", margin: 0 }}>
                    RECENT ACTIVITY
                </h2>
            </div>
            <div className="feed-list">
                {recentCommits.length === 0 ? (
                    <p className="muted">No commits yet. Be the first!</p>
                ) : (
                    recentCommits.map((commit, i) => (
                        <div
                            key={`${commit.odId}-${i}`}
                            className="feed-item"
                            style={{ display: "block", marginBottom: "1rem" }}
                        >
                            <div
                                className="feed-item-row"
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    width: "100%",
                                }}
                            >
                                <div
                                    style={{ display: "flex", alignItems: "center", gap: "0.5ch" }}
                                >
                                    <img
                                        src={commit.avatarUrl}
                                        alt=""
                                        className="avatar"
                                        width={24}
                                        height={24}
                                        loading="lazy"
                                        decoding="async"
                                        style={{ backgroundColor: "var(--border)" }}
                                    />
                                    <span>
                                        <span className="username" style={{ fontWeight: "bold" }}>
                                            {commit.username}
                                        </span>{" "}
                                        committed
                                    </span>
                                </div>
                                <span className="muted">{commit.relativeTime}</span>
                            </div>
                            {(commit.messageHtml || commit.attachments.length > 0) && (
                                <div
                                    className="feed-item-content"
                                    style={{ paddingLeft: "32px", marginTop: "0.25rem" }}
                                >
                                    {commit.messageHtml && (
                                        <div
                                            className="feed-item-message muted"
                                            style={{
                                                display: "flex",
                                                flexDirection: "row",
                                                gap: "0.5ch",
                                                textAlign: "left",
                                            }}
                                        >
                                            <span>└→</span>
                                            <div
                                                style={{ flex: 1 }}
                                                className="markdown-content"
                                                dangerouslySetInnerHTML={{
                                                    __html: commit.messageHtml,
                                                }}
                                            />
                                        </div>
                                    )}
                                    {commit.attachments.length > 0 && (
                                        <div
                                            className="feed-item-attachments"
                                            style={{
                                                display: "flex",
                                                gap: "0.5rem",
                                                marginTop: "0.5rem",
                                                flexWrap: "wrap",
                                            }}
                                        >
                                            {(() => {
                                                let imageIndex = 0;
                                                return commit.attachments.map((attachment, idx) => {
                                                    if (isVideo(attachment.type)) {
                                                        return (
                                                            <video
                                                                key={idx}
                                                                src={attachment.url}
                                                                controls
                                                                muted
                                                                preload="metadata"
                                                                aria-label={`Video attachment from ${commit.username}`}
                                                                style={{
                                                                    maxWidth: "200px",
                                                                    maxHeight: "150px",
                                                                    borderRadius: "4px",
                                                                    border: "1px solid var(--border)",
                                                                }}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        );
                                                    } else if (isImage(attachment.type)) {
                                                        const currentImageIndex = imageIndex;
                                                        imageIndex++;
                                                        return (
                                                            <button
                                                                key={idx}
                                                                type="button"
                                                                aria-label={`View attachment ${currentImageIndex + 1} in fullscreen`}
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    openLightbox(
                                                                        commit.attachments,
                                                                        currentImageIndex,
                                                                        e.currentTarget,
                                                                    );
                                                                }}
                                                                style={{
                                                                    padding: 0,
                                                                    border: "1px solid var(--border)",
                                                                    borderRadius: "4px",
                                                                    background: "none",
                                                                    cursor: "pointer",
                                                                }}
                                                            >
                                                                <img
                                                                    src={attachment.url}
                                                                    alt={`Commit attachment ${currentImageIndex + 1} from ${commit.username}`}
                                                                    width={200}
                                                                    height={150}
                                                                    loading="lazy"
                                                                    decoding="async"
                                                                    style={{
                                                                        maxWidth: "200px",
                                                                        maxHeight: "150px",
                                                                        width: "auto",
                                                                        height: "auto",
                                                                        borderRadius: "4px",
                                                                        backgroundColor:
                                                                            "var(--border)",
                                                                        display: "block",
                                                                    }}
                                                                />
                                                            </button>
                                                        );
                                                    } else if (isAudio(attachment.type)) {
                                                        return (
                                                            <audio
                                                                key={idx}
                                                                src={attachment.url}
                                                                controls
                                                                preload="metadata"
                                                                aria-label={`Audio attachment from ${commit.username}`}
                                                                style={{
                                                                    maxWidth: "250px",
                                                                    height: "40px",
                                                                    borderRadius: "4px",
                                                                }}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        );
                                                    } else {
                                                        return (
                                                            <a
                                                                key={idx}
                                                                href={attachment.url}
                                                                target="_blank"
                                                                rel="nofollow noopener noreferrer"
                                                            >
                                                                <span
                                                                    className="attachment-link"
                                                                    style={{
                                                                        padding: "0.25rem 0.5rem",
                                                                        border: "1px solid var(--border)",
                                                                        borderRadius: "4px",
                                                                    }}
                                                                >
                                                                    📎 {attachment.filename}
                                                                </span>
                                                            </a>
                                                        );
                                                    }
                                                });
                                            })()}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
                {hasMore && (
                    <div
                        ref={sentinelRef}
                        className="feed-sentinel"
                        style={{ padding: "1rem 0", textAlign: "center" }}
                    >
                        {isLoadingMore && <span className="muted">Loading more...</span>}
                    </div>
                )}
                {!hasMore && allCommits.length > 0 && (
                    <div
                        className="feed-end muted"
                        style={{ padding: "1rem 0", textAlign: "center" }}
                    >
                        ── End of feed ──
                    </div>
                )}
            </div>
            {lightbox.isOpen && (
                <Lightbox
                    attachments={lightbox.attachments}
                    currentIndex={lightbox.currentIndex}
                    onClose={closeLightbox}
                    onPrev={goToPrev}
                    onNext={goToNext}
                />
            )}
        </section>
    );
}
