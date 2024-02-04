import { OpenAIModel, Source } from "@/types";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import type { NextApiRequest, NextApiResponse } from "next";
import { cleanSourceText } from "../../utils/sources";
import axios from 'axios';

type Data = {
  sources: Source[];
};

async function extractUrlsFromYandex(query: string): Promise<string[]> {
    const params = {
        folderid: '#',
        apikey: '#',
        query: query
    };

    try {
        const response = await axios.get('https://yandex.ru/search/xml', { params });
        const urls = response.data.match(/<url>(https?:\/\/[^<]+)<\/url>/g).map((url: string) => url.replace(/<\/?url>/g, ''));
        return urls;
    } catch (error) {
        console.error('Error fetching URLs from Yandex:', error);
        return [];
    }
}

async function fetchContentFromOurApi(query: string): Promise<Source[]> {
    try {
        const response = await axios.post('http://localhost:8000/generate/', {
            text: query,
        });
        const sources = response.data.responses.map((item) => ({
            url: item.url,
            text: item.answer,
        }));
        return sources;
    } catch (error) {
        console.error('Error fetching content from our API:', error);
        return [];
    }
}

const searchHandler = async (req: NextApiRequest, res: NextApiResponse<Data>) => {
  try {
    const { query, model } = req.body as {
      query: string;
      model: OpenAIModel;
    };
    
    // Fetching URLs from Yandex
    const yandexUrls = await extractUrlsFromYandex(query);
    const maxUrls = 5;
    const finalLinks = yandexUrls.slice(0, maxUrls);

    // Fetching content from Yandex URLs
    const yandexSources: Source[] = (await Promise.all(
      finalLinks.map(async (link) => {
        try {
          const response = await fetch(link);
          const html = await response.text();
          const dom = new JSDOM(html);
          const doc = dom.window.document;
          const parsed = new Readability(doc).parse();

          if (parsed) {
            let sourceText = cleanSourceText(parsed.textContent);
            return { url: link, text: sourceText };
          }
        } catch (error) {
          console.error('Error fetching or extracting content from URL:', error);
        }
      })
    )).filter((source): source is Source => source !== undefined);

    // Fetching content from our API
    const ourApiSources = await fetchContentFromOurApi(query);

    // Combining sources from Yandex and our API, and truncating text
    const combinedSources = [...yandexSources, ...ourApiSources].map(source => ({
      ...source,
      text: source.text.slice(0, 2000) // Truncate text if necessary
    }));

    res.status(200).json({ sources: combinedSources });
  } catch (err) {
    console.log(err);
    res.status(500).json({ sources: [] });
  }
};

export default searchHandler;