class YouTubeApiError extends Error {
  constructor(message, details = {}) {
    super(message);

    this.name = "YouTubeApiError";
    this.status = details.status;
    this.reason = details.reason;
    this.payload = details.payload;
  }
}

function extractChannelLookup(sourceUrl) {
  const parsedUrl = new URL(sourceUrl);
  const segments = parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);

  if (
    segments[0] === "channel" &&
    segments[1]
  ) {
    return {
      type: "id",
      value: segments[1]
    };
  }

  if (segments[0]?.startsWith("@")) {
    return {
      type: "handle",
      value: segments[0].slice(1)
    };
  }

  throw new Error(
    `Unsupported YouTube channel URL: ${sourceUrl}`
  );
}

async function youtubeRequest(
  resource,
  params,
  {
    apiKey,
    onRequest = null
  }
) {
  if (!apiKey) {
    throw new Error(
      "YOUTUBE_API_KEY is required."
    );
  }

  const url = new URL(
    `https://www.googleapis.com/youtube/v3/${resource}`
  );

  url.search = new URLSearchParams({
    ...params,
    key: apiKey
  }).toString();

  if (onRequest) {
    onRequest({
      resource,
      units: 1
    });
  }

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    const reason =
      payload?.error?.errors?.[0]?.reason ??
      payload?.error?.status ??
      "unknown";

    throw new YouTubeApiError(
      payload?.error?.message ??
        `YouTube API request failed with HTTP ${response.status}.`,
      {
        status: response.status,
        reason,
        payload
      }
    );
  }

  return payload;
}

async function resolveChannel(
  source,
  options
) {
  if (
    source.youtube_channel_id &&
    source.youtube_uploads_playlist_id
  ) {
    return {
      channelId:
        source.youtube_channel_id,
      channelTitle: source.name,
      uploadsPlaylistId:
        source.youtube_uploads_playlist_id,
      cached: true
    };
  }

  const lookup = extractChannelLookup(
    source.url
  );

  const params = {
    part: "id,snippet,contentDetails",
    maxResults: "1"
  };

  if (lookup.type === "id") {
    params.id = lookup.value;
  } else {
    params.forHandle = lookup.value;
  }

  const payload = await youtubeRequest(
    "channels",
    params,
    options
  );

  const channel = payload.items?.[0];

  if (!channel) {
    throw new Error(
      `YouTube channel was not found for ${source.name}.`
    );
  }

  const uploadsPlaylistId =
    channel.contentDetails
      ?.relatedPlaylists
      ?.uploads;

  if (!uploadsPlaylistId) {
    throw new Error(
      `Uploads playlist was not found for ${source.name}.`
    );
  }

  return {
    channelId: channel.id,
    channelTitle:
      channel.snippet?.title ??
      source.name,
    uploadsPlaylistId,
    cached: false
  };
}

async function fetchUploadVideoIds(
  uploadsPlaylistId,
  maxResults,
  options
) {
  const payload = await youtubeRequest(
    "playlistItems",
    {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: String(maxResults)
    },
    options
  );

  return [
    ...new Set(
      (payload.items ?? [])
        .map(
          item =>
            item.contentDetails?.videoId
        )
        .filter(Boolean)
    )
  ];
}

function chunk(values, size) {
  const chunks = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(
      values.slice(index, index + size)
    );
  }

  return chunks;
}

function selectThumbnail(thumbnails = {}) {
  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null
  );
}

async function fetchVideos(
  videoIds,
  options
) {
  const uniqueIds = [...new Set(videoIds)];

  if (uniqueIds.length === 0) {
    return [];
  }

  const videos = [];

  for (
    const videoIdBatch of chunk(
      uniqueIds,
      50
    )
  ) {
    const payload = await youtubeRequest(
      "videos",
      {
        part:
          "id,snippet,contentDetails,statistics,status",
        id: videoIdBatch.join(","),
        maxResults: "50"
      },
      options
    );

    for (const item of payload.items ?? []) {
      videos.push({
        videoId: item.id,
        channelId:
          item.snippet?.channelId ?? null,
        channelTitle:
          item.snippet?.channelTitle ??
          null,
        title:
          item.snippet?.title ??
          "Untitled YouTube video",
        description:
          item.snippet?.description ??
          "",
        tags: Array.isArray(
          item.snippet?.tags
        )
          ? item.snippet.tags
          : [],
        publishedAt:
          item.snippet?.publishedAt ??
          null,
        thumbnailUrl: selectThumbnail(
          item.snippet?.thumbnails
        ),
        duration:
          item.contentDetails?.duration ??
          null,
        views: Number(
          item.statistics?.viewCount ?? 0
        ),
        likes: Number(
          item.statistics?.likeCount ?? 0
        ),
        comments: Number(
          item.statistics?.commentCount ??
            0
        ),
        privacyStatus:
          item.status?.privacyStatus ??
          null,
        liveBroadcastContent:
          item.snippet
            ?.liveBroadcastContent ??
          "none"
      });
    }
  }

  return videos;
}

module.exports = {
  YouTubeApiError,
  extractChannelLookup,
  fetchUploadVideoIds,
  fetchVideos,
  resolveChannel,
  youtubeRequest
};
