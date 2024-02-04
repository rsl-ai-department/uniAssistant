from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
from torch.nn import functional as F
import torch
from transformers import AutoTokenizer, AutoModel
from torch import Tensor
import torch.nn.functional as F
from faiss import read_index

index = read_index("disser_search_e5_multilingual_FAISS.index")

#Mean Pooling - Take attention mask into account for correct averaging
def average_pool(last_hidden_states: Tensor,
                 attention_mask: Tensor) -> Tensor:
    last_hidden = last_hidden_states.masked_fill(~attention_mask[..., None].bool(), 0.0)
    return last_hidden.sum(dim=1) / attention_mask.sum(dim=1)[..., None]

device = 'cpu'
#Load AutoModel from huggingface model repository
tokenizer = AutoTokenizer.from_pretrained("intfloat/multilingual-e5-base")
model = AutoModel.from_pretrained("intfloat/multilingual-e5-base").to(device)

from razdel import sentenize
from glob import glob
from tqdm import tqdm

sent_list = []
files = sorted(glob('pdfs_txts/*'))[:]
for idx, txt_page_filename in tqdm(enumerate(files[:500]), total=len(files)):
    with open(txt_page_filename, 'r') as f:
        text = f.read()
    code = txt_page_filename.split('_page')[0].split('/')[-1]
    page_num = str(int(txt_page_filename.split('_page')[-1].split('.')[0]) + 1)
    sentences = list([sent.text for sent in sentenize(text) if len(sent.text) > 30])
    book_page_rsl_url = f"https://viewer.rsl.ru/ru/{code}?page={page_num}&rotate=0&theme=black"
    for sent_ in sentences:
        sent_list.append((sent_, book_page_rsl_url))

app = FastAPI()

class Message(BaseModel):
    text: str

@app.post("/generate/")
async def generate(message: Message):
    new_text = message.text
    encoded_input = tokenizer(['query: ' + new_text], max_length=512, padding=True, 
                              truncation=True, return_tensors='pt')
    # Compute token embeddings
    with torch.no_grad():
        model_output = model(**encoded_input)
    # Perform pooling. In this case, mean pooling
    embedding = average_pool(model_output.last_hidden_state, 
                                       encoded_input['attention_mask'])
    embedding = F.normalize(embedding, p=2, dim=1)
    D, I = index.search(embedding, 5)
    response = []
    for idx in I[0]:
        # answer = '\n'.join([_[0] for _ in sent_list[idx-3:idx+1]])
        url = sent_list[idx][1]
        answer = '\n'.join([sent_list[_][0] for _ in range(idx-3, idx+1)])
        response.append({"id": int(idx), "answer": answer, "url": url})
    return {"responses": response}
