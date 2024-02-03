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

const searchHandler = async (req: NextApiRequest, res: NextApiResponse<Data>) => {
  try {
    const { query, model } = req.body as {
      query: string;
      model: OpenAIModel;
    };
    
    const urls = await extractUrlsFromYandex(query);
    const maxUrls = 5;
    const finalLinks = urls.slice(0, maxUrls);

    const sources: Source[] = (await Promise.all(
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
    ))
    
    const filteredSources = sources.filter((source) => source !== undefined);

    for (const source of filteredSources) {
      source.text = source.text.slice(0, 1500);
    }

    res.status(200).json({ sources: filteredSources });
  } catch (err) {
    console.log(err);
    res.status(500).json({ sources: [] });
  }
};

export default searchHandler;
